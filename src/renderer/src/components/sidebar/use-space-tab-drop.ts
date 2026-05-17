import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { getWorktreeMapFromState } from '@/store/selectors'
import { hasRepoDragData, readRepoDragId } from './repo-drag-types'
import { hasWorkspaceDragData, readWorkspaceDragData } from './workspace-status'

const SPACE_TAB_DROP_TARGET_SELECTOR = '[data-space-drop-target]'
const ALL_PROJECTS_MARKER = 'all'

// Why: Electron's preload bridge (src/preload/index.ts) installs a document
// capture-phase `drop` listener that stopPropagation()s every drop whose
// dataTransfer is not a native OS file drop, which silently kills React's
// synthetic onDrop on SpaceTab. Routing via a document capture listener
// mirrors useWorkspaceStatusDocumentDrop and lands the drop before preload
// can cancel it.
export function useSpaceTabDocumentDrop(enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return
    }

    const handleDrop = (event: DragEvent): void => {
      const dataTransfer = event.dataTransfer
      if (!dataTransfer) {
        return
      }
      if (!hasRepoDragData(dataTransfer) && !hasWorkspaceDragData(dataTransfer)) {
        return
      }
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }
      const dropTarget = target.closest<HTMLElement>(SPACE_TAB_DROP_TARGET_SELECTOR)
      if (!dropTarget) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const rawTarget = dropTarget.dataset.spaceDropTarget ?? ''
      const targetSpaceId = rawTarget === ALL_PROJECTS_MARKER ? null : rawTarget
      const store = useAppStore.getState()

      const directRepoId = readRepoDragId(dataTransfer)
      if (directRepoId) {
        store.moveRepoToSpace(directRepoId, targetSpaceId)
        return
      }
      const worktreeId = readWorkspaceDragData(dataTransfer)
      if (!worktreeId) {
        return
      }
      const worktree = getWorktreeMapFromState(store).get(worktreeId)
      if (worktree) {
        store.moveRepoToSpace(worktree.repoId, targetSpaceId)
      }
    }

    document.addEventListener('drop', handleDrop, true)
    return () => {
      document.removeEventListener('drop', handleDrop, true)
    }
  }, [enabled])
}
