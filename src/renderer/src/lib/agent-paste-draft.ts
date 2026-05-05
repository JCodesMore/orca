import type { TuiAgent } from '../../../shared/types'
import { TUI_AGENT_CONFIG } from '../../../shared/tui-agent-config'
import { useAppStore } from '@/store'
import { subscribeToPtyData } from '@/components/terminal-pane/pty-dispatcher'

// Why: bracketed paste markers let modern TUIs (Claude Code / Codex / Pi /
// OpenCode / Gemini / cursor-agent / copilot) treat the inserted text as a
// single atomic paste — the payload lands in the input buffer as a draft
// instead of echoing character-by-character or triggering line-edit
// shortcuts. Intentionally omit a trailing '\r' so the draft never auto-
// submits; the user reviews and sends the prompt themselves.
const BRACKETED_PASTE_BEGIN = '\x1b[200~'
const BRACKETED_PASTE_END = '\x1b[201~'

// Why: every prefill-capable TUI we ship support for (claude / codex / pi /
// opencode / gemini / cursor-agent / copilot) emits `CSI ? 2004 h` (DECSET
// 2004 — bracketed-paste-enable) on its output stream the moment its input
// box is rendered. That escape sequence IS the protocol-level "I am ready
// to receive a bracketed paste" handshake. Watching for it on the PTY
// stream gives us a deterministic signal — no empirical 2.5s floor, no
// title-stable heuristic, no foreground-process polling. As soon as the
// TUI advertises it, the next byte we write is the paste itself.
const DECSET_BRACKETED_PASTE = '\x1b[?2004h'

// Why: deterministic signals can fail in two ways: (1) a user runs a TUI
// that never enables bracketed paste (extremely rare for the agents we
// target — none observed in practice), or (2) a launch fails and the agent
// never renders. The fallback budget here is a hard upper bound, not a
// target — under normal operation we paste within milliseconds of the
// agent emitting DECSET 2004.
const READINESS_TIMEOUT_MS = 8000

/**
 * Wait until the agent on `tabId` has rendered its input-accepting TUI,
 * then bracketed-paste `content` into its input buffer. Never appends
 * `\r`, so the draft stays editable for the user to review / append before
 * sending.
 *
 * Returns true when the paste was issued, false on timeout or missing PTY.
 * `onTimeout` lets the caller surface a UI hint (e.g. toast) when the
 * agent doesn't reach a ready state inside `timeoutMs`.
 *
 * Readiness is detected by tapping the live PTY data stream and looking
 * for `\x1b[?2004h` (DECSET 2004 — bracketed-paste-enable). That escape is
 * what every prefill-capable TUI emits the moment its input layer is
 * wired up, so it is *the* protocol-level "accepting paste now" signal.
 * No empirical timing is involved.
 */
export async function pasteDraftWhenAgentReady(args: {
  tabId: string
  expectedProcess: string
  content: string
  agent?: TuiAgent
  timeoutMs?: number
  onTimeout?: () => void
}): Promise<boolean> {
  const { tabId, content, agent, timeoutMs, onTimeout } = args

  // Why: agents with a documented prefill flag (currently Claude — see
  // TUI_AGENT_CONFIG.claude.draftPromptFlag) launch with the URL already
  // in their input box. Pasting again would duplicate it. Callers should
  // not invoke this helper for those agents; the early return guards
  // against accidental double-injection if a stale call slips through.
  if (agent && TUI_AGENT_CONFIG[agent].draftPromptFlag) {
    return false
  }

  const budget = timeoutMs ?? READINESS_TIMEOUT_MS
  const ptyId = await waitForPtyId(tabId, budget)
  if (!ptyId) {
    onTimeout?.()
    return false
  }

  const ready = await waitForBracketedPasteEnable(ptyId, budget)
  if (!ready) {
    onTimeout?.()
    return false
  }

  window.api.pty.write(ptyId, `${BRACKETED_PASTE_BEGIN}${content}${BRACKETED_PASTE_END}`)
  return true
}

/**
 * Tap the PTY data stream as a side-channel observer (does NOT take over
 * the primary handler that feeds xterm) and resolve `true` as soon as we
 * see DECSET 2004 land. Resolves `false` if the budget expires first.
 *
 * Sidecar subscription is the right pattern here because:
 *   - the main pane may attach mid-flight; we must not race against its
 *     handler registration.
 *   - DECSET 2004 may straddle two data chunks at ANSI parser boundaries,
 *     so we keep a small ring of recent bytes and search the union.
 */
function waitForBracketedPasteEnable(ptyId: string, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false
    let recent = ''
    let unsubscribe: (() => void) | null = null

    const finish = (value: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      window.clearTimeout(timer)
      unsubscribe?.()
      resolve(value)
    }

    unsubscribe = subscribeToPtyData(ptyId, (data) => {
      // Why: keep just enough recent bytes that an escape sequence split
      // across two IPC frames is still detectable. 64 bytes >> 8-byte
      // sequence; cheap and bounded.
      recent = (recent + data).slice(-64)
      if (recent.includes(DECSET_BRACKETED_PASTE)) {
        finish(true)
      }
    })

    const timer = window.setTimeout(() => finish(false), timeoutMs)
  })
}

/**
 * Why: activation creates the tab synchronously but the PTY spawn is
 * async. Poll the store until the primary PTY id appears or the budget
 * expires. Tight interval because the wait is normally <200ms — only the
 * first launch on a cold app reaches the tail of this.
 */
async function waitForPtyId(tabId: string, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ptyId = useAppStore.getState().ptyIdsByTabId[tabId]?.[0]
    if (ptyId) {
      return ptyId
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50))
  }
  return null
}
