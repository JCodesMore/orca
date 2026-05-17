import type {
  AgentStatusEntry,
  MigrationUnsupportedPtyEntry
} from '../../../../shared/agent-status-types'
import type { TerminalTab, Worktree } from '../../../../shared/types'
import type { RetainedAgentEntry } from '@/store/slices/agent-status'
import type { AppState } from '@/store'

export const LEAF_A = '11111111-1111-4111-8111-111111111111'
export const LEAF_B = '22222222-2222-4222-8222-222222222222'
export const LEAF_C = '33333333-3333-4333-8333-333333333333'
export const LEAF_D = '44444444-4444-4444-8444-444444444444'

export type StoreInputs = {
  tabsByWorktree?: Record<string, TerminalTab[]>
  worktreesByRepo?: Record<string, Worktree[]>
  repoSpaceAssignments?: Record<string, string>
  agentStatusByPaneKey?: Record<string, AgentStatusEntry>
  retainedAgentsByPaneKey?: Record<string, RetainedAgentEntry>
  migrationUnsupportedByPtyId?: Record<string, MigrationUnsupportedPtyEntry>
  acknowledgedAgentsByPaneKey?: Record<string, number>
}

export function makeState(inputs: StoreInputs = {}): AppState {
  return {
    tabsByWorktree: {},
    worktreesByRepo: {},
    repoSpaceAssignments: {},
    agentStatusByPaneKey: {},
    retainedAgentsByPaneKey: {},
    migrationUnsupportedByPtyId: {},
    acknowledgedAgentsByPaneKey: {},
    ...inputs
  } as unknown as AppState
}

export function makeTab(id: string, worktreeId: string): TerminalTab {
  return {
    id,
    ptyId: 'pty-1',
    worktreeId,
    title: 'bash',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

export function makeWorktree(id: string, repoId: string): Worktree {
  return {
    id,
    repoId,
    path: `/tmp/${id}`,
    head: '',
    branch: '',
    isBare: false,
    isMainWorktree: false,
    displayName: id,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0
  }
}

export function makeEntry(args: {
  paneKey: string
  state: AgentStatusEntry['state']
  stateStartedAt?: number
  history?: AgentStatusEntry['stateHistory']
}): AgentStatusEntry {
  return {
    paneKey: args.paneKey,
    state: args.state,
    prompt: '',
    updatedAt: args.stateStartedAt ?? 1_000,
    stateStartedAt: args.stateStartedAt ?? 1_000,
    stateHistory: args.history ?? []
  }
}

export function makeRetained(entry: AgentStatusEntry, worktreeId: string): RetainedAgentEntry {
  return {
    entry,
    worktreeId,
    tab: makeTab('retained-tab', worktreeId),
    agentType: 'unknown',
    startedAt: entry.stateStartedAt
  }
}
