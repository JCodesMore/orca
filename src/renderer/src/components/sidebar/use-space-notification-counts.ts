import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { countUnreadAgentEvents } from '@/lib/agent-status-unread'
import { migrationUnsupportedToAgentStatusEntry } from '@/lib/migration-unsupported-agent-entry'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { AppState } from '@/store'

/**
 * Per-Space unread agent-event count, keyed by spaceId.
 *
 * Worktrees whose repo has no Space assignment are intentionally excluded —
 * those events are surfaced by `selectAllAgentsUnreadCount` instead, which
 * powers the "All Projects" pill and the Activity titlebar badge.
 *
 * Why nothing drifts: every reader in this file routes through
 * `countUnreadAgentEvents`, so the per-Space pills, the All Projects pill,
 * and the titlebar share one definition of "unread".
 */
export function selectSpaceNotificationCounts(state: AppState): Record<string, number> {
  const counts: Record<string, number> = {}

  // Why: build the reverse `tabId → worktreeId` map once per evaluation so
  // each live-agent pane lookup is O(1) instead of scanning every worktree's
  // tab list for every entry.
  const tabIdToWorktreeId = new Map<string, string>()
  for (const [worktreeId, tabs] of Object.entries(state.tabsByWorktree)) {
    for (const tab of tabs) {
      tabIdToWorktreeId.set(tab.id, worktreeId)
    }
  }

  // Why: worktreeId encodes its repoId via the worktree-id format, but we
  // already iterate `worktreesByRepo` to flatten — caching the
  // `worktreeId → repoId` mapping keeps the per-entry lookup O(1) and avoids
  // re-parsing the encoded id (which several stale-snapshot ids in tests do
  // not follow).
  const worktreeIdToRepoId = new Map<string, string>()
  for (const [repoId, worktrees] of Object.entries(state.worktreesByRepo)) {
    for (const worktree of worktrees) {
      worktreeIdToRepoId.set(worktree.id, repoId)
    }
  }

  const addToSpace = (worktreeId: string | undefined, events: number): void => {
    if (!worktreeId || events === 0) {
      return
    }
    const repoId = worktreeIdToRepoId.get(worktreeId)
    if (!repoId) {
      return
    }
    const spaceId = state.repoSpaceAssignments[repoId]
    if (!spaceId) {
      return
    }
    counts[spaceId] = (counts[spaceId] ?? 0) + events
  }

  for (const [paneKey, entry] of Object.entries(state.agentStatusByPaneKey)) {
    const events = countUnreadAgentEvents(entry, state.acknowledgedAgentsByPaneKey[paneKey] ?? 0)
    if (events === 0) {
      continue
    }
    const parsed = parsePaneKey(paneKey)
    if (!parsed) {
      continue
    }
    addToSpace(tabIdToWorktreeId.get(parsed.tabId), events)
  }

  for (const [paneKey, retained] of Object.entries(state.retainedAgentsByPaneKey)) {
    const events = countUnreadAgentEvents(
      retained.entry,
      state.acknowledgedAgentsByPaneKey[paneKey] ?? 0
    )
    addToSpace(retained.worktreeId, events)
  }

  for (const unsupported of Object.values(state.migrationUnsupportedByPtyId)) {
    const entry = migrationUnsupportedToAgentStatusEntry(unsupported)
    if (!entry) {
      continue
    }
    const events = countUnreadAgentEvents(
      entry,
      state.acknowledgedAgentsByPaneKey[entry.paneKey] ?? 0
    )
    if (events === 0) {
      continue
    }
    // Why: migration-unsupported entries can carry an explicit worktreeId
    // (when the registry knew it at the time the legacy pane was seen).
    // Fall back to the paneKey reverse lookup so a worktreeId-less entry
    // still counts when its tab is still in tabsByWorktree.
    let worktreeId = unsupported.worktreeId
    if (!worktreeId) {
      const parsed = parsePaneKey(entry.paneKey)
      if (parsed) {
        worktreeId = tabIdToWorktreeId.get(parsed.tabId)
      }
    }
    addToSpace(worktreeId, events)
  }

  return counts
}

export function useSpaceNotificationCounts(): Record<string, number> {
  return useAppStore(useShallow(selectSpaceNotificationCounts))
}

/**
 * Total unread agent events across every repo — assigned, unassigned, retained,
 * and migration-unsupported alike. Drives both the "All Projects" pill badge
 * and the Activity titlebar count, so the two cannot diverge.
 */
export function selectAllAgentsUnreadCount(state: AppState): number {
  let count = 0
  for (const [paneKey, entry] of Object.entries(state.agentStatusByPaneKey)) {
    count += countUnreadAgentEvents(entry, state.acknowledgedAgentsByPaneKey[paneKey] ?? 0)
  }
  for (const [paneKey, retained] of Object.entries(state.retainedAgentsByPaneKey)) {
    count += countUnreadAgentEvents(retained.entry, state.acknowledgedAgentsByPaneKey[paneKey] ?? 0)
  }
  for (const unsupported of Object.values(state.migrationUnsupportedByPtyId)) {
    const entry = migrationUnsupportedToAgentStatusEntry(unsupported)
    if (!entry) {
      continue
    }
    count += countUnreadAgentEvents(entry, state.acknowledgedAgentsByPaneKey[entry.paneKey] ?? 0)
  }
  return count
}

export function useAllAgentsUnreadCount(): number {
  return useAppStore(selectAllAgentsUnreadCount)
}
