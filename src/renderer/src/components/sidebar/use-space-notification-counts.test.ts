import { describe, expect, it } from 'vitest'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import {
  LEAF_A,
  LEAF_B,
  LEAF_C,
  LEAF_D,
  makeEntry,
  makeRetained,
  makeState,
  makeTab,
  makeWorktree
} from './space-notification-test-fixtures'
import {
  selectAllAgentsUnreadCount,
  selectSpaceNotificationCounts
} from './use-space-notification-counts'

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

describe('selectAllAgentsUnreadCount', () => {
  it('returns 0 for an empty store', () => {
    expect(selectAllAgentsUnreadCount(makeState())).toBe(0)
  })

  it('sums unread across assigned and unassigned repos', () => {
    const paneOrca = makePaneKey('tab-orca-1', LEAF_A)
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
        [paneOrca]: makeEntry({
          paneKey: paneOrca,
          state: 'blocked',
          stateStartedAt: 2_000,
          history: [{ state: 'done', prompt: '', startedAt: 1_500 }]
        }),
        [paneBusiness]: makeEntry({
          paneKey: paneBusiness,
          state: 'done',
          stateStartedAt: 2_000
        }),
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

    // 2 (orca) + 1 (business) + 5 (unassigned) = 8
    expect(selectAllAgentsUnreadCount(state)).toBe(8)

    // The load-bearing invariant: All Projects = Σ(per-Space) + unassigned.
    const perSpace = selectSpaceNotificationCounts(state)
    const spaceSum = Object.values(perSpace).reduce((a, b) => a + b, 0)
    expect(selectAllAgentsUnreadCount(state)).toBe(spaceSum + 5)
  })

  it('respects acknowledgement timestamps', () => {
    const paneAck = makePaneKey('tab-ack', LEAF_A)
    const paneFresh = makePaneKey('tab-fresh', LEAF_B)

    const state = makeState({
      agentStatusByPaneKey: {
        [paneAck]: makeEntry({ paneKey: paneAck, state: 'done', stateStartedAt: 1_000 }),
        [paneFresh]: makeEntry({ paneKey: paneFresh, state: 'done', stateStartedAt: 2_000 })
      },
      acknowledgedAgentsByPaneKey: {
        [paneAck]: 5_000,
        [paneFresh]: 1_500
      }
    })

    expect(selectAllAgentsUnreadCount(state)).toBe(1)
  })

  it('counts retained agents regardless of Space assignment', () => {
    const retainedAssigned = makePaneKey('tab-assigned-vanished', LEAF_A)
    const retainedUnassigned = makePaneKey('tab-unassigned-vanished', LEAF_B)

    const state = makeState({
      worktreesByRepo: {
        'repo-orca': [makeWorktree('wt-orca', 'repo-orca')]
      },
      repoSpaceAssignments: { 'repo-orca': 'space-orca' },
      retainedAgentsByPaneKey: {
        [retainedAssigned]: makeRetained(
          makeEntry({ paneKey: retainedAssigned, state: 'done', stateStartedAt: 1_000 }),
          'wt-orca'
        ),
        [retainedUnassigned]: makeRetained(
          makeEntry({ paneKey: retainedUnassigned, state: 'done', stateStartedAt: 2_000 }),
          'wt-floating'
        )
      }
    })

    expect(selectAllAgentsUnreadCount(state)).toBe(2)
  })

  it('includes migration-unsupported entries', () => {
    const migrationPane = makePaneKey('tab-legacy', LEAF_D)

    const state = makeState({
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

    expect(selectAllAgentsUnreadCount(state)).toBe(1)
  })
})
