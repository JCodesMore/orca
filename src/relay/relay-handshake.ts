// Wire-level handshake helpers for the Orca relay.
//
// Why this lives in its own module: oxlint enforces a 300-line limit (with
// blanks/comments stripped) on .ts files, and relay.ts already runs near that
// limit. Splitting the version-handshake plumbing into a sibling module keeps
// relay.ts focused on the daemon-lifecycle wiring and makes the handshake
// independently unit-testable.

import { dirname, join } from 'path'
import { existsSync, readFileSync } from 'fs'
import type { Socket } from 'net'
import {
  RELAY_VERSION,
  MessageType,
  FrameDecoder,
  encodeHandshakeFrame,
  parseHandshakeMessage,
  type DecodedFrame
} from './protocol'

// Why: a unique exit code reserved for the wire-level version-mismatch terminal
// condition. The client (waitForSentinel + ssh.ts) maps this exit code to a
// non-retryable RelayVersionMismatchError so _onRelayLost skips the backoff
// loop. Any other non-zero exit is treated as a transient transport error.
export const EXIT_CODE_VERSION_MISMATCH = 42

// Why: the deploy step writes a content-hashed version marker (e.g.
// "0.1.0+0a5fe134d020") into ${remoteDir}/.version next to relay.js. Read it
// from the directory the running script lives in (NOT process.cwd()) so test
// spawns from arbitrary working dirs still report a coherent version. Falls
// back to bare RELAY_VERSION if the marker is missing — the wire handshake
// will then refuse a fresh client whose .version differs.
export function readLaunchVersion(): string {
  try {
    const entry = process.argv[1]
    const dir = entry ? dirname(entry) : process.cwd()
    const versionFile = join(dir, '.version')
    if (existsSync(versionFile)) {
      const v = readFileSync(versionFile, 'utf-8').trim()
      if (v) {
        return v
      }
    }
  } catch {
    /* fall through */
  }
  return RELAY_VERSION
}

// ── Daemon side ─────────────────────────────────────────────────────

export type DaemonHandshakeCallbacks = {
  onAccepted: (sock: Socket) => void
  launchVersion: string
}

// Why: pre-dispatcher version handshake. The daemon reads exactly one
// Handshake-typed frame off this freshly-accepted socket BEFORE the JSON-RPC
// dispatcher pipe is attached. Mismatch means the connecting bridge was
// launched against a different relay.js version than the daemon was; we close
// the socket so the bridge exits 42 and the client surfaces a typed error
// instead of looping over the dispatcher.
export function setupDaemonHandshake(sock: Socket, cb: DaemonHandshakeCallbacks): void {
  const decoder = new FrameDecoder(
    (frame: DecodedFrame) => {
      handleDaemonHandshakeFrame(sock, frame, cb)
    },
    (err) => {
      process.stderr.write(`[relay] Handshake decode error: ${err.message}\n`)
      sock.destroy()
    }
  )

  const onHandshakeData = (chunk: Buffer): void => {
    decoder.feed(chunk)
  }
  sock.on('data', onHandshakeData)
  ;(sock as Socket & { __orcaOnHandshake?: typeof onHandshakeData }).__orcaOnHandshake =
    onHandshakeData
}

export function detachHandshakeListener(sock: Socket): void {
  const tagged = sock as Socket & { __orcaOnHandshake?: (chunk: Buffer) => void }
  if (tagged.__orcaOnHandshake) {
    sock.removeListener('data', tagged.__orcaOnHandshake)
    delete tagged.__orcaOnHandshake
  }
}

function handleDaemonHandshakeFrame(
  sock: Socket,
  frame: DecodedFrame,
  cb: DaemonHandshakeCallbacks
): void {
  if (frame.type !== MessageType.Handshake) {
    process.stderr.write(
      `[relay] Protocol violation pre-handshake: type=${frame.type}; closing socket\n`
    )
    sock.destroy()
    return
  }
  let msg: ReturnType<typeof parseHandshakeMessage>
  try {
    msg = parseHandshakeMessage(frame.payload)
  } catch (err) {
    process.stderr.write(
      `[relay] Could not parse handshake: ${(err as Error).message}; closing socket\n`
    )
    sock.destroy()
    return
  }
  if (msg.type !== 'orca-relay-handshake') {
    process.stderr.write(
      `[relay] Unexpected handshake type from client: ${msg.type}; closing socket\n`
    )
    sock.destroy()
    return
  }
  if (msg.version !== cb.launchVersion) {
    process.stderr.write(
      `[relay] Handshake mismatch: own=${cb.launchVersion}, client=${msg.version}; closing socket\n`
    )
    try {
      sock.write(
        encodeHandshakeFrame({
          type: 'orca-relay-handshake-mismatch',
          expected: cb.launchVersion,
          got: msg.version
        })
      )
    } catch {
      /* best-effort — close+exit-42 still wins */
    }
    sock.end()
    return
  }
  process.stderr.write(`[relay] Handshake OK from version=${msg.version}\n`)
  sock.write(encodeHandshakeFrame({ type: 'orca-relay-handshake-ok', version: cb.launchVersion }))
  detachHandshakeListener(sock)
  cb.onAccepted(sock)
}

// ── --connect side ──────────────────────────────────────────────────

export type ConnectHandshakeCallbacks = {
  onAccepted: () => void
}

// Why: the wire-level version handshake from the bridge side. Before we attach
// the bidirectional pipe (and before we write RELAY_SENTINEL to stdout to
// unblock the client), we send a Handshake-typed frame carrying our version
// and wait for the daemon's Handshake response. This is defense-in-depth on
// top of the versioned-install-dir layout: a corrupt/missing .version, hash
// collision, or legacy-fallback path would otherwise let a v2 bridge drive a
// v1 daemon. VS Code's remoteExtensionHostAgentServer.ts:340 does the same
// check.
export function runConnectHandshake(
  sock: Socket,
  myVersion: string,
  cb: ConnectHandshakeCallbacks
): void {
  let handshakeDone = false

  const decoder = new FrameDecoder(
    (frame: DecodedFrame) => {
      if (handshakeDone) {
        return
      }
      if (frame.type !== MessageType.Handshake) {
        process.stderr.write(
          `[relay-connect] Protocol violation: expected Handshake frame, got type=${frame.type}\n`
        )
        sock.destroy()
        process.exit(1)
      }
      let msg: ReturnType<typeof parseHandshakeMessage>
      try {
        msg = parseHandshakeMessage(frame.payload)
      } catch (err) {
        process.stderr.write(
          `[relay-connect] Could not parse handshake reply: ${(err as Error).message}\n`
        )
        sock.destroy()
        process.exit(1)
      }
      if (msg.type === 'orca-relay-handshake-ok') {
        process.stderr.write(`[relay-connect] Handshake OK at version=${msg.version}\n`)
        handshakeDone = true
        sock.removeAllListeners('data')
        cb.onAccepted()
        return
      }
      if (msg.type === 'orca-relay-handshake-mismatch') {
        process.stderr.write(
          `[relay-connect] Handshake mismatch: expected=${msg.expected}, daemon=${msg.got}; exiting ${EXIT_CODE_VERSION_MISMATCH}\n`
        )
        sock.destroy()
        process.exit(EXIT_CODE_VERSION_MISMATCH)
      }
      process.stderr.write(`[relay-connect] Unexpected handshake type: ${msg.type}\n`)
      sock.destroy()
      process.exit(1)
    },
    (err) => {
      process.stderr.write(`[relay-connect] Handshake decode error: ${err.message}\n`)
      sock.destroy()
      process.exit(1)
    }
  )

  sock.on('data', (chunk: Buffer) => {
    if (!handshakeDone) {
      decoder.feed(chunk)
    }
  })

  sock.write(encodeHandshakeFrame({ type: 'orca-relay-handshake', version: myVersion }))
}
