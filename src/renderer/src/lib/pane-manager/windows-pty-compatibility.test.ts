import { describe, expect, it } from 'vitest'
import { buildWindowsPtyCompatibilityOptions } from './windows-pty-compatibility'

describe('buildWindowsPtyCompatibilityOptions', () => {
  const windowsUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'

  it('enables ConPTY compatibility for local native Windows terminals', () => {
    expect(
      buildWindowsPtyCompatibilityOptions({
        userAgent: windowsUserAgent,
        connectionId: null,
        cwd: 'C:\\Users\\jinwo\\orca'
      })
    ).toEqual({ windowsPty: { backend: 'conpty' } })
  })

  it('does not apply ConPTY compatibility to WSL cwd terminals', () => {
    expect(
      buildWindowsPtyCompatibilityOptions({
        userAgent: windowsUserAgent,
        connectionId: null,
        cwd: '\\\\wsl.localhost\\Ubuntu\\home\\jinwo\\orca'
      })
    ).toEqual({})
  })

  it('does not apply ConPTY compatibility to WSL shell override terminals', () => {
    expect(
      buildWindowsPtyCompatibilityOptions({
        userAgent: windowsUserAgent,
        connectionId: null,
        cwd: 'C:\\Users\\jinwo\\orca',
        shellOverride: 'wsl.exe'
      })
    ).toEqual({})
  })

  it('does not apply ConPTY compatibility to SSH terminals viewed from Windows', () => {
    expect(
      buildWindowsPtyCompatibilityOptions({
        userAgent: windowsUserAgent,
        connectionId: 'ssh-1',
        cwd: '/home/jinwo/orca'
      })
    ).toEqual({})
  })

  it('does not apply ConPTY compatibility on non-Windows clients', () => {
    expect(
      buildWindowsPtyCompatibilityOptions({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        connectionId: null,
        cwd: '/Users/jinwo/orca'
      })
    ).toEqual({})
  })
})
