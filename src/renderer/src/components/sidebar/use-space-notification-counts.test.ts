import { describe, expect, it } from 'vitest'
import type {
  AgentStatusEntry,
  MigrationUnsupportedPtyEntry
} from '../../../../shared/agent-status-types'
import type { TerminalTab, Worktree } from '../../../../shared/types'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import type { RetainedAgentEntry } from '@/store/slices/agent-status'
import type { AppState } from '@/store'
import { selectSpaceNotificationCounts } from './use-space-notification-counts'

const LEAF_A = '11111111-1111-4111-8111-111111111111'
const LEAF_B = '22222222-2222-4222-8222-222222222222'
const LEAF_C = '33333333-3333-4333-8333-333333333333'
const LEAF_D = '44444444-4444-4444-8444-444444444444'

type StoreInputs = {
  tabsByWorktree?: Record<string, TerminalTab[]>
  worktreesByRepo?: Record<string, Worktree[]>
  repoSpaceAssignments?: Record<string, string>
  agentStatusByPaneKey?: Record<string, AgentStatusEntry>
  retainedAgentsByPaneKey?: Record<string, RetainedAgentEntry>
  migrationUnsupportedByPtyId?: Record<string, MigrationUnsupportedPtyEntry>
  acknowledgedAgentsByPaneKey?: Record<string, number>
}

function makeState(inputs: StoreInputs = {}): AppState {
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

function makeTab(id: string, worktreeId: string): TerminalTab {
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

function makeWorktree(id: string, repoId: string): Worktree {
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

function makeEntry(args: {
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

function makeRetained(entry: AgentStatusEntry, worktreeId: string): RetainedAgentEntry {
  return {
    entry,
    worktreeId,
    tab: makeTab('retained-tab', worktreeId),
    agentType: 'unknown',
    startedAt: entry.stateStartedAt
  }
}

describe('selectSpaceNotificationCounts', () => {
  it('returns {} for an empty store', () => {
    expect(selectSpaceNotificationCounts(makeState())).toEqual({})
  })

  it('counts unread events per space, skipping unassigned repos', () => {
    const paneOrcaA = makePaneKey('tab-orca-1', LEAF_A)
    const paneBusiness = makePaneKey('tab-business-1', LEAF_B)
    const paneUnassigned = makePaneKey('tab-unassigned-1', LEAF_C)

    const state = makeState({
      tabsByWorktree: {
        'wt-orca': [makeTab('tab-orca-1', 'wt-orca')],
        'wt-business': [makeTab('tab-business-1', 'wt-business')],
        'wt-unassigned': [makeTab('tab-unassigned-1', 'wt-unassigned')]
      },
      worktreesByRepo: {
        'repo-orca': [makeWorktree('wt-orca', 'repo-orca')],
        'repo-business': [makeWorktree('wt-business', 'repo-business')],
        'repo-unassigned': [makeWorktree('wt-unassigned', 'repo-unassigned')]
      },
      repoSpaceAssignments: {
        'repo-orca': 'space-orca',
        'repo-business': 'space-business'
      },
      agentStatusByPaneKey: {
        // 2 unread for orca: one historical `done`, one live `blocked`.
        [paneOrcaA]: makeEntry({
          paneKey: paneOrcaA,
          state: 'blocked',
          stateStartedAt: 2_000,
          history: [{ state: 'done', prompt: '', startedAt: 1_500 }]
        }),
        // 1 unread for business.
        [paneBusiness]: makeEntry({
          paneKey: paneBusiness,
          state: 'done',
          stateStartedAt: 2_000
        }),
        // 5 unread for an unassigned repo — must not be counted under any space.
        [paneUnassigned]: makeEntry({
          paneKey: paneUnassigned,
          state: 'waiting',
          stateStartedAt: 5_000,
          history: [
            { state: 'done', prompt: '', startedAt: 1_000 },
            { state: 'blocked', prompt: '', startedAt: 2_000 },
            { state: 'waiting', prompt: '', startedAt: 3_000 },
            { state: 'done', prompt: '', startedAt: 4_000 }
          ]
        })
      }
    })

    expect(selectSpaceNotificationCounts(state)).toEqual({
      'space-orca': 2,
      'space-business': 1
    })
  })

  it('respects acknowledgement timestamps', () => {
    const paneAck = makePaneKey('tab-ack', LEAF_A)
    const paneFresh = makePaneKey('tab-fresh', LEAF_B)

    const state = makeState({
      tabsByWorktree: {
        'wt-ack': [makeTab('tab-ack', 'wt-ack')],
        'wt-fresh': [makeTab('tab-fresh', 'wt-fresh')]
      },
      worktreesByRepo: {
        'repo-ack': [makeWorktree('wt-ack', 'repo-ack')],
        'repo-fresh': [makeWorktree('wt-fresh', 'repo-fresh')]
      },
      repoSpaceAssignments: {
        'repo-ack': 'space-x',
        'repo-fresh': 'space-x'
      },
      agentStatusByPaneKey: {
        [paneAck]: makeEntry({ paneKey: paneAck, state: 'done', stateStartedAt: 1_000 }),
        [paneFresh]: makeEntry({ paneKey: paneFresh, state: 'done', stateStartedAt: 2_000 })
      },
      acknowledgedAgentsByPaneKey: {
        // Acknowledged after the event → not counted.
        [paneAck]: 5_000,
        // Acknowledged before the event → still unread.
        [paneFresh]: 1_500
      }
    })

    expect(selectSpaceNotificationCounts(state)).toEqual({ 'space-x': 1 })
  })

  it('counts retained agents via their stored worktreeId (no pane-key reverse lookup)', () => {
    const retainedPane = makePaneKey('tab-vanished', LEAF_A)

    const state = makeState({
      // Tab is gone from tabsByWorktree — the entry only resolves via retained.worktreeId.
      tabsByWorktree: {},
      worktreesByRepo: {
        'repo-orca': [makeWorktree('wt-orca', 'repo-orca')]
      },
      repoSpaceAssignments: { 'repo-orca': 'space-orca' },
      retainedAgentsByPaneKey: {
        [retainedPane]: makeRetained(
          makeEntry({ paneKey: retainedPane, state: 'done', stateStartedAt: 1_000 }),
          'wt-orca'
        )
      }
    })

    expect(selectSpaceNotificationCounts(state)).toEqual({ 'space-orca': 1 })
  })

  it('includes migration-unsupported entries', () => {
    const migrationPane = makePaneKey('tab-legacy', LEAF_D)

    const state = makeState({
      tabsByWorktree: {
        'wt-legacy': [makeTab('tab-legacy', 'wt-legacy')]
      },
      worktreesByRepo: {
        'repo-legacy': [makeWorktree('wt-legacy', 'repo-legacy')]
      },
      repoSpaceAssignments: { 'repo-legacy': 'space-legacy' },
      migrationUnsupportedByPtyId: {
        'pty-legacy-1': {
          ptyId: 'pty-legacy-1',
          paneKey: migrationPane,
          worktreeId: 'wt-legacy',
          reason: 'legacy-numeric-pane-key',
          source: 'local',
          updatedAt: 1_000
        }
      }
    })

    expect(selectSpaceNotificationCounts(state)).toEqual({ 'space-legacy': 1 })
  })
})
