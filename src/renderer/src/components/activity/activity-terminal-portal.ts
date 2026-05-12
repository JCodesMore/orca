import { useLayoutEffect, useState } from 'react'

export const ACTIVITY_TERMINAL_PORTAL_TARGET_ID = 'activity-terminal-portal-target'

export type ActivityTerminalPortalTarget = {
  target: HTMLElement
  worktreeId: string
  tabId: string
}

export function useActivityTerminalPortalTarget(enabled: boolean): HTMLElement | null {
  const [target, setTarget] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    if (!enabled || typeof document === 'undefined') {
      setTarget(null)
      return
    }

    let animationFrame: number | null = null
    const syncTarget = (): void => {
      const nextTarget = document.getElementById(ACTIVITY_TERMINAL_PORTAL_TARGET_ID)
      setTarget((currentTarget) => (currentTarget === nextTarget ? currentTarget : nextTarget))
    }
    const scheduleSync = (): void => {
      if (animationFrame !== null) {
        return
      }
      animationFrame = requestAnimationFrame(() => {
        animationFrame = null
        syncTarget()
      })
    }

    syncTarget()
    // Why: ActivityPrototypePage is a lazy sibling of Terminal, so the portal
    // target can appear/disappear without Terminal itself remounting.
    const observer = new MutationObserver(scheduleSync)
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame)
      }
    }
  }, [enabled])

  return target
}
