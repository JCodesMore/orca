import { join } from 'path'
import { existsSync } from 'fs'
import { app } from 'electron'
import { createHash } from 'crypto'
import type { SshConnection } from './ssh-connection'
import { parseUnameToRelayPlatform, type RelayPlatform } from './relay-protocol'
import type { MultiplexerTransport } from './ssh-channel-multiplexer'
import {
  uploadDirectory,
  waitForSentinel,
  execCommand,
  resolveRemoteNodePath
} from './ssh-relay-deploy-helpers'
import {
  readLocalFullVersion,
  computeRemoteRelayDir,
  isRelayAlreadyInstalled,
  acquireInstallLock,
  finalizeInstall,
  abandonInstall,
  gcOldRelayVersions
} from './ssh-relay-versioned-install'
import { shellEscape } from './ssh-connection-utils'

export type RelayDeployResult = {
  transport: MultiplexerTransport
  platform: RelayPlatform
}

// Why: individual exec commands have 30s timeouts, but the full deploy
// pipeline (detect platform → check existing → upload → npm install →
// launch) has no overall bound. A hanging `npm install` or slow SFTP
// upload could block the connection indefinitely.
const RELAY_DEPLOY_TIMEOUT_MS = 120_000

/**
 * Deploy the relay to the remote host and launch it.
 *
 * Steps:
 * 1. Detect remote OS/arch via `uname -sm`
 * 2. Check if correct relay version is already deployed
 * 3. If not, SCP the relay package
 * 4. Launch relay via exec channel
 * 5. Wait for ORCA-RELAY sentinel on stdout
 * 6. Return the transport (relay's stdin/stdout) for multiplexer use
 */
export async function deployAndLaunchRelay(
  conn: SshConnection,
  onProgress?: (status: string) => void,
  graceTimeSeconds?: number,
  relayInstanceId?: string
): Promise<RelayDeployResult> {
  let timeoutHandle: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Relay deployment timed out after ${RELAY_DEPLOY_TIMEOUT_MS / 1000}s`))
    }, RELAY_DEPLOY_TIMEOUT_MS)
  })

  try {
    return await Promise.race([
      deployAndLaunchRelayInner(conn, onProgress, graceTimeSeconds, relayInstanceId),
      timeoutPromise
    ])
  } finally {
    clearTimeout(timeoutHandle!)
  }
}

async function deployAndLaunchRelayInner(
  conn: SshConnection,
  onProgress?: (status: string) => void,
  graceTimeSeconds?: number,
  relayInstanceId?: string
): Promise<RelayDeployResult> {
  onProgress?.('Detecting remote platform...')
  console.log('[ssh-relay] Detecting remote platform...')
  const platform = await detectRemotePlatform(conn)
  if (!platform) {
    throw new Error(
      'Unsupported remote platform. Orca relay supports: linux-x64, linux-arm64, darwin-x64, darwin-arm64.'
    )
  }
  console.log(`[ssh-relay] Platform: ${platform}`)

  const localRelayDir = getLocalRelayPath(platform)
  if (!localRelayDir) {
    throw new Error(
      `Relay package for ${platform} not found locally. ` +
        `This may be a packaging issue — try reinstalling Orca.`
    )
  }
  // Why: read the content-hashed full version from the local build's .version
  // file. Used as both the remote dir name and the wire-handshake version.
  // Throws on missing/empty rather than silently falling back — see
  // docs/ssh-relay-versioned-install-dirs.md "Data Flow: Upstream Error".
  const fullVersion = readLocalFullVersion(localRelayDir)

  // Why: SFTP does not expand `~`, so we must resolve the remote home directory
  // explicitly. `echo $HOME` over exec gives us the absolute path.
  const remoteHome = (await execCommand(conn, 'echo $HOME')).trim()
  // Why: we only interpolate $HOME into single-quoted shell strings later, so
  // this validation only needs to reject obviously unsafe control characters.
  // Allow spaces and non-ASCII so valid home directories are not rejected.
  // oxlint-disable-next-line no-control-regex
  if (!remoteHome || !remoteHome.startsWith('/') || /[\u0000\r\n]/.test(remoteHome)) {
    throw new Error(`Remote $HOME is not a valid path: ${remoteHome.slice(0, 100)}`)
  }
  const remoteRelayDir = computeRemoteRelayDir(remoteHome, fullVersion)
  console.log(`[ssh-relay] Remote dir: ${remoteRelayDir}`)

  onProgress?.('Checking existing relay...')
  const alreadyInstalled = await isRelayAlreadyInstalled(conn, remoteRelayDir)
  console.log(`[ssh-relay] Already installed at ${fullVersion}: ${alreadyInstalled}`)

  if (!alreadyInstalled) {
    // Why: serialize concurrent first-installs of the same version against
    // each other via an atomic mkdir lock. The losing caller polls and either
    // re-checks `alreadyInstalled` (now true) or steals a stale lock.
    await acquireInstallLock(conn, remoteRelayDir)
    try {
      // Re-probe after acquiring the lock — a sibling installer may have
      // finished while we were waiting.
      if (!(await isRelayAlreadyInstalled(conn, remoteRelayDir))) {
        onProgress?.('Uploading relay...')
        console.log('[ssh-relay] Uploading relay...')
        await uploadRelay(conn, platform, remoteRelayDir, fullVersion)
        console.log('[ssh-relay] Upload complete')

        onProgress?.('Installing native dependencies...')
        console.log('[ssh-relay] Installing node-pty...')
        await installNativeDeps(conn, remoteRelayDir)
        console.log('[ssh-relay] Native deps installed')

        // Why: write `.install-complete` BEFORE releasing the lock so a
        // sibling never observes the dir as "complete but locked", which
        // would lead GC to skip a recoverable dir indefinitely.
        await finalizeInstall(conn, remoteRelayDir)
      } else {
        await abandonInstall(conn, remoteRelayDir)
      }
    } catch (err) {
      // Why: leave a partial install dir in place (no `.install-complete`)
      // so the next deploy detects the partial and re-runs upload + install.
      // Just release the lock so a concurrent caller can retry.
      await abandonInstall(conn, remoteRelayDir)
      throw err
    }
  }

  onProgress?.('Starting relay...')
  console.log('[ssh-relay] Launching relay...')
  const transport = await launchRelay(conn, remoteRelayDir, graceTimeSeconds, relayInstanceId)
  console.log('[ssh-relay] Relay started successfully')

  // Why: best-effort cleanup of unreferenced sibling version dirs. Errors
  // are logged inside gcOldRelayVersions and never propagate, so a GC failure
  // can never block the user from connecting.
  void gcOldRelayVersions(conn, remoteHome, remoteRelayDir).catch(() => {})

  return { transport, platform }
}

async function detectRemotePlatform(conn: SshConnection): Promise<RelayPlatform | null> {
  const output = await execCommand(conn, 'uname -sm')
  const parts = output.trim().split(/\s+/)
  if (parts.length < 2) {
    return null
  }
  return parseUnameToRelayPlatform(parts[0], parts[1])
}

async function uploadRelay(
  conn: SshConnection,
  platform: RelayPlatform,
  remoteDir: string,
  fullVersion: string
): Promise<void> {
  const localRelayDir = getLocalRelayPath(platform)
  if (!localRelayDir || !existsSync(localRelayDir)) {
    throw new Error(
      `Relay package for ${platform} not found at ${localRelayDir}. ` +
        `This may be a packaging issue — try reinstalling Orca.`
    )
  }

  // Create remote directory
  await execCommand(conn, `mkdir -p ${shellEscape(remoteDir)}`)

  // Upload via SFTP
  const sftp = await conn.sftp()

  try {
    await uploadDirectory(sftp, localRelayDir, remoteDir)
  } finally {
    sftp.end()
  }

  // Make the node binary executable
  await execCommand(conn, `chmod +x ${shellEscape(`${remoteDir}/node`)} 2>/dev/null; true`)

  // Why: write `.version` via SFTP rather than shell to avoid quoting issues
  // with content-hashed version strings. The remote daemon reads this same
  // file on startup so the wire-handshake validates against it.
  const versionSftp = await conn.sftp()
  try {
    await new Promise<void>((resolve, reject) => {
      const ws = versionSftp.createWriteStream(`${remoteDir}/.version`)
      ws.on('close', resolve)
      ws.on('error', reject)
      ws.end(fullVersion)
    })
  } finally {
    versionSftp.end()
  }
}

// Why: node-pty is a native addon that can't be bundled by esbuild. It must
// be compiled on the remote host against its Node.js version and OS. We run
// `npm init -y && npm install node-pty` in the relay directory so
// `require('node-pty')` resolves to the local node_modules.
async function installNativeDeps(conn: SshConnection, remoteDir: string): Promise<void> {
  const nodePath = await resolveRemoteNodePath(conn)
  // Why: node's bin directory must be in PATH for npm's child processes.
  // npm install runs node-pty's prebuild script (`node scripts/prebuild.js`)
  // which spawns `node` as a child — if node isn't in PATH, that child
  // fails with exit 127 even though we invoked npm via its full path.
  const nodeBinDir = nodePath.replace(/\/node$/, '')
  const escapedDir = shellEscape(remoteDir)
  const escapedBinDir = shellEscape(nodeBinDir)

  try {
    await execCommand(
      conn,
      `export PATH=${escapedBinDir}:$PATH && cd ${escapedDir} && npm init -y --silent 2>/dev/null && npm install node-pty 2>&1`
    )
    // Why: SFTP uploads preserve file content but not Unix execute bits.
    // node-pty ships a prebuilt `spawn-helper` binary that must be executable
    // for posix_spawnp to fork the PTY process.
    await execCommand(
      conn,
      `find ${shellEscape(`${remoteDir}/node_modules/node-pty/prebuilds`)} -name spawn-helper -exec chmod +x {} + 2>/dev/null; true`
    )
  } catch (err) {
    // Why: node-pty install can fail if build tools (python, make, g++) are
    // missing on the remote. Log the error but don't block relay startup —
    // the relay will degrade gracefully (pty.spawn returns an error).
    console.warn('[ssh-relay] Failed to install node-pty:', (err as Error).message)
  }
}

function getLocalRelayPath(platform: RelayPlatform): string | null {
  if (process.env.ORCA_RELAY_PATH) {
    const override = join(process.env.ORCA_RELAY_PATH, platform)
    if (existsSync(override)) {
      return override
    }
  }

  // Production: bundled alongside the app
  const prodPath = join(app.getAppPath(), 'resources', 'relay', platform)
  if (existsSync(prodPath)) {
    return prodPath
  }

  // Development: built by `pnpm build:relay` into out/relay/{platform}/
  const devPath = join(app.getAppPath(), 'out', 'relay', platform)
  if (existsSync(devPath)) {
    return devPath
  }

  return null
}

async function launchRelay(
  conn: SshConnection,
  remoteDir: string,
  graceTimeSeconds?: number,
  relayInstanceId?: string
): Promise<MultiplexerTransport> {
  // Why: Phase 1 of the plan requires Node.js on the remote. We use the
  // system `node` rather than bundling a node binary, keeping the relay
  // package small (~100KB JS vs ~60MB with embedded node).
  // Non-login SSH shells may not have node in PATH, so we source the
  // user's profile to pick up nvm/fnm/brew PATH entries.
  const nodePath = await resolveRemoteNodePath(conn)
  // Why: graceTimeSeconds originates from user-editable SshTarget config.
  // Clamping to integer prevents shell injection if the type ever loosened.
  const graceTime = Math.max(60, Math.min(3600, Math.floor(graceTimeSeconds ?? 300)))
  const escapedDir = shellEscape(remoteDir)
  const escapedNode = shellEscape(nodePath)
  // Why: remoteRelayDir is shared by every Orca target for the same remote
  // account. Hashing the target ID into the socket name prevents one target
  // from attaching to another target's live relay.
  const sockName = relayInstanceId
    ? `relay-${hashRelayInstanceId(relayInstanceId)}.sock`
    : 'relay.sock'
  const sockFile = `${remoteDir}/${sockName}`

  // Why: after an app restart a relay may still be running in its grace
  // period with live PTY sessions.  We check for its Unix socket and
  // launch in --connect mode to bridge the new SSH channel to the
  // existing relay process — preserving PTY state and scrollback.
  try {
    const probeOutput = await execCommand(
      conn,
      `test -S ${shellEscape(sockFile)} && echo ALIVE || echo DEAD`
    )
    console.warn(`[ssh-relay] Socket probe result: "${probeOutput.trim()}"`)
    if (probeOutput.trim() === 'ALIVE') {
      console.log('[ssh-relay] Existing relay socket found, attempting reconnect...')
      try {
        const channel = await conn.exec(
          `cd ${escapedDir} && ${escapedNode} relay.js --connect --sock-path ${shellEscape(sockFile)}`
        )
        const transport = await waitForSentinel(channel)
        console.log('[ssh-relay] Reconnected to existing relay via socket')
        return transport
      } catch (err) {
        console.warn(
          '[ssh-relay] Socket reconnect failed, launching fresh relay:',
          err instanceof Error ? err.message : String(err)
        )
        // Why: stale socket from a crashed relay — remove it so the
        // fresh launch can bind a new socket at the same path.
        await execCommand(conn, `rm -f ${shellEscape(sockFile)}`).catch(() => {})
      }
    }
  } catch {
    // Probe failed — fall through to fresh launch
  }

  // Why: the relay must outlive the SSH connection so PTY sessions survive
  // app restarts.  nohup prevents SIGHUP death, </dev/null detaches stdin,
  // and & backgrounds the process so it's not a direct child of the exec
  // channel.  When sshd tears down the session the relay continues as an
  // orphan adopted by init, listening on its Unix socket for a --connect
  // bridge from the next app launch.
  // Why: execCommand waits for the channel to close, but SSH channels stay
  // open while backgrounded children exist (even with fd redirection).
  // Fire-and-forget via conn.exec: we don't need the output — the socket
  // poll below detects readiness.
  const logFile = `${remoteDir}/relay.log`
  const launchCmd = `cd ${escapedDir} && nohup ${escapedNode} relay.js --detached --grace-time ${graceTime} --sock-path ${shellEscape(sockFile)} > ${shellEscape(logFile)} 2>&1 </dev/null &`
  const launchChannel = await conn.exec(launchCmd)
  launchChannel.on('data', () => {})
  launchChannel.on('error', () => {})
  launchChannel.stderr.on('data', () => {})
  launchChannel.stderr.on('error', () => {})
  // Why: the shell exits quickly (nohup ... &), but the SSH channel stays
  // open until all child fds close. Explicitly closing it after the poll
  // loop prevents channel accumulation across relay restarts, which would
  // eventually hit the server's MaxSessions limit.
  launchChannel.on('close', () => {})

  // Why: the backgrounded relay needs time to bind its Unix socket.  We
  // poll rather than sleep a fixed duration because remote host speed
  // varies widely (CI vs. Raspberry Pi).
  // Why: checking `test -S` only verifies the inode exists, not that the
  // relay is listening. After a stale socket removal + fresh launch, the
  // old inode can linger briefly. We probe with a connect-and-close to
  // confirm the socket is actually accepting connections.
  const POLL_INTERVAL_MS = 200
  const POLL_TIMEOUT_MS = 10_000
  const pollStart = Date.now()
  let socketReady = false
  while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
    try {
      // Why: node is guaranteed to exist on the remote (we just deployed
      // the relay with it). Using it to probe the socket is more portable
      // than python3/socat/perl which may not be installed. The socket
      // path is passed as argv[1] to avoid shell quoting issues with -e.
      const result = await execCommand(
        conn,
        `${escapedNode} -e 'var s=require("net").connect(process.argv[1]);s.on("connect",function(){s.destroy();process.stdout.write("READY")});s.on("error",function(){process.stdout.write("WAITING")})' ${shellEscape(sockFile)} 2>/dev/null || (test -S ${shellEscape(sockFile)} && echo READY || echo WAITING)`
      )
      if (result.trim() === 'READY') {
        socketReady = true
        break
      }
    } catch {
      /* exec failed, retry */
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }

  // Why: close the fire-and-forget launch channel now that the relay's
  // socket is either ready or the poll timed out. Leaving it open leaks
  // an SSH channel per relay restart.
  launchChannel.close()

  if (!socketReady) {
    const logOutput = await execCommand(
      conn,
      `tail -20 ${shellEscape(logFile)} 2>/dev/null || echo "(no log)"`
    ).catch(() => '(could not read log)')
    throw new Error(`Relay failed to start within ${POLL_TIMEOUT_MS / 1000}s. Log:\n${logOutput}`)
  }

  // Why: the backgrounded relay's stdout goes to a log file, not the exec
  // channel.  We connect via --connect which bridges this new channel's
  // stdin/stdout to the relay's Unix socket — same path used for reconnect
  // after app restart.
  const channel = await conn.exec(
    `cd ${escapedDir} && ${escapedNode} relay.js --connect --sock-path ${shellEscape(sockFile)}`
  )
  return waitForSentinel(channel)
}

function hashRelayInstanceId(relayInstanceId: string): string {
  return createHash('sha256').update(relayInstanceId).digest('hex').slice(0, 16)
}
