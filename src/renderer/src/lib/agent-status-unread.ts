import type { AgentStatusEntry, AgentStatusState } from '../../../shared/agent-status-types'

// Why: single source of truth for "what counts as unread" — the Activity
// titlebar badge and per-space pill badges both consume this so the totals
// can never drift. An entry's unread events include every historical
// done/blocked/waiting transition still ahead of the user's ack, plus the
// current state when it qualifies.

function isUnreadState(state: AgentStatusState): boolean {
  return state === 'done' || state === 'blocked' || state === 'waiting'
}

export function countUnreadAgentEvents(entry: AgentStatusEntry, ackAt: number): number {
  let count = 0
  for (const history of entry.stateHistory) {
    if (isUnreadState(history.state) && ackAt < history.startedAt) {
      count += 1
    }
  }
  if (isUnreadState(entry.state) && ackAt < entry.stateStartedAt) {
    count += 1
  }
  return count
}
