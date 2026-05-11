import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn()
}))

vi.mock('./ssh-relay-deploy-helpers', () => ({
  execCommand: vi.fn()
}))

vi.mock('./ssh-connection-utils', () => ({
  shellEscape: (s: string) => `'${s}'`
}))

import { existsSync, readFileSync } from 'fs'
import {
  readLocalFullVersion,
  computeRemoteRelayDir,
  isRelayAlreadyInstalled,
  acquireInstallLock,
  finalizeInstall,
  abandonInstall,
  gcOldRelayVersions
} from './ssh-relay-versioned-install'
import { execCommand } from './ssh-relay-deploy-helpers'
import type { SshConnection } from './ssh-connection'

const conn = {} as SshConnection
const mockExec = vi.mocked(execCommand)
const mockExists = vi.mocked(existsSync)
const mockRead = vi.mocked(readFileSync)

describe('readLocalFullVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns trimmed contents of the .version file', () => {
    mockExists.mockReturnValue(true)
    mockRead.mockReturnValue('0.1.0+deadbeef\n')
    expect(readLocalFullVersion('/local/relay')).toBe('0.1.0+deadbeef')
  })

  it('throws an actionable error when the .version file is missing', () => {
    mockExists.mockReturnValue(false)
    expect(() => readLocalFullVersion('/local/relay')).toThrow(/missing its version marker/)
  })

  it('throws when the .version file is empty', () => {
    mockExists.mockReturnValue(true)
    mockRead.mockReturnValue('   \n')
    expect(() => readLocalFullVersion('/local/relay')).toThrow(/is empty/)
  })
})

describe('computeRemoteRelayDir', () => {
  it('joins remoteHome with .orca-remote and the version-keyed dir name', () => {
    expect(computeRemoteRelayDir('/home/u', '0.1.0+abc')).toBe(
      '/home/u/.orca-remote/relay-0.1.0+abc'
    )
  })
})

describe('isRelayAlreadyInstalled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns true only when the OK probe succeeds', async () => {
    mockExec.mockResolvedValueOnce('OK')
    expect(await isRelayAlreadyInstalled(conn, '/r')).toBe(true)
  })

  it('returns false when the probe reports MISSING', async () => {
    mockExec.mockResolvedValueOnce('MISSING')
    expect(await isRelayAlreadyInstalled(conn, '/r')).toBe(false)
  })

  it('returns false on exec error', async () => {
    mockExec.mockRejectedValueOnce(new Error('boom'))
    expect(await isRelayAlreadyInstalled(conn, '/r')).toBe(false)
  })

  it('checks for relay.js AND .install-complete in addition to the dir', async () => {
    mockExec.mockResolvedValueOnce('OK')
    await isRelayAlreadyInstalled(conn, '/r')
    const cmd = mockExec.mock.calls.at(-1)?.[1] ?? ''
    expect(cmd).toContain('relay.js')
    expect(cmd).toContain('.install-complete')
  })
})

describe('acquireInstallLock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns when mkdir reports OK', async () => {
    // 1st call: mkdir -p remoteRelayDir
    // 2nd call: mkdir lockDir → OK
    mockExec.mockResolvedValueOnce('').mockResolvedValueOnce('OK')
    await acquireInstallLock(conn, '/r')
    expect(mockExec).toHaveBeenCalledTimes(2)
  })

  it('finalizeInstall writes .install-complete then removes the lock', async () => {
    mockExec.mockResolvedValueOnce('').mockResolvedValueOnce('')
    await finalizeInstall(conn, '/r')
    const cmds = mockExec.mock.calls.map(([, c]) => c)
    expect(cmds[0]).toContain('touch')
    expect(cmds[0]).toContain('.install-complete')
    expect(cmds[1]).toContain('rm -rf')
    expect(cmds[1]).toContain('.install-lock')
  })

  it('abandonInstall removes the lock without writing the sentinel', async () => {
    mockExec.mockResolvedValueOnce('')
    await abandonInstall(conn, '/r')
    const cmd = mockExec.mock.calls[0]?.[1] ?? ''
    expect(cmd).toContain('rm -rf')
    expect(cmd).toContain('.install-lock')
    expect(cmd).not.toContain('.install-complete')
  })
})

describe('gcOldRelayVersions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('removes a sibling that is complete, unlocked, and has no live socket', async () => {
    // ls listing
    mockExec.mockResolvedValueOnce('relay-0.1.0+aaa\nrelay-0.1.0+bbb\n')
    // For sibling "aaa": LOCKED probe → OPEN, COMPLETE probe → COMPLETE, sock probe → empty (no ALIVE), then rm -rf
    mockExec
      .mockResolvedValueOnce('OPEN')
      .mockResolvedValueOnce('COMPLETE')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')

    await gcOldRelayVersions(conn, '/home/u', '/home/u/.orca-remote/relay-0.1.0+bbb')

    const lastCmd = mockExec.mock.calls.at(-1)?.[1] ?? ''
    expect(lastCmd).toContain('rm -rf')
    expect(lastCmd).toContain('relay-0.1.0+aaa')
  })

  it('skips siblings that are missing .install-complete (mid-install or partial)', async () => {
    mockExec.mockResolvedValueOnce('relay-0.1.0+aaa\n')
    mockExec
      .mockResolvedValueOnce('OPEN') // not locked
      .mockResolvedValueOnce('PARTIAL') // missing .install-complete
    await gcOldRelayVersions(conn, '/home/u', '/home/u/.orca-remote/relay-0.1.0+bbb')
    const cmds = mockExec.mock.calls.map(([, c]) => c)
    expect(cmds.some((c) => c.includes('rm -rf'))).toBe(false)
  })

  it('skips siblings whose .install-lock is held', async () => {
    mockExec.mockResolvedValueOnce('relay-0.1.0+aaa\n')
    mockExec.mockResolvedValueOnce('LOCKED')
    await gcOldRelayVersions(conn, '/home/u', '/home/u/.orca-remote/relay-0.1.0+bbb')
    const cmds = mockExec.mock.calls.map(([, c]) => c)
    expect(cmds.some((c) => c.includes('rm -rf'))).toBe(false)
  })

  it('skips siblings with a live relay-*.sock', async () => {
    mockExec.mockResolvedValueOnce('relay-0.1.0+aaa\n')
    mockExec
      .mockResolvedValueOnce('OPEN')
      .mockResolvedValueOnce('COMPLETE')
      .mockResolvedValueOnce('ALIVE')
    await gcOldRelayVersions(conn, '/home/u', '/home/u/.orca-remote/relay-0.1.0+bbb')
    const cmds = mockExec.mock.calls.map(([, c]) => c)
    expect(cmds.some((c) => c.includes('rm -rf'))).toBe(false)
  })

  it('does not consider the current dir as a GC candidate', async () => {
    mockExec.mockResolvedValueOnce('relay-0.1.0+aaa\n')
    await gcOldRelayVersions(conn, '/home/u', '/home/u/.orca-remote/relay-0.1.0+aaa')
    expect(mockExec.mock.calls.length).toBe(1) // only the listing
  })

  it('ignores entries that do not match the relay version dir regex (allowlist)', async () => {
    mockExec.mockResolvedValueOnce('logs\nbackup\nrelay-0.1.0+aaa\n')
    mockExec
      .mockResolvedValueOnce('OPEN')
      .mockResolvedValueOnce('COMPLETE')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
    await gcOldRelayVersions(conn, '/home/u', '/home/u/.orca-remote/relay-0.1.0+bbb')
    const cmds = mockExec.mock.calls.map(([, c]) => c)
    const rmCmds = cmds.filter((c) => c.includes('rm -rf'))
    expect(rmCmds).toHaveLength(1)
    expect(rmCmds[0]).toContain('relay-0.1.0+aaa')
    expect(rmCmds[0]).not.toContain('logs')
    expect(rmCmds[0]).not.toContain('backup')
  })
})
