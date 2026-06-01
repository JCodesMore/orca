import React, { useCallback, useEffect } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { useAppStore } from '@/store'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSidebarResize } from '@/hooks/useSidebarResize'
import SidebarHeader from './SidebarHeader'
import SidebarNav from './SidebarNav'
import SpaceTabs from './SpaceTabs'
import SetupScriptPromptCard from './SetupScriptPromptCard'
import WorktreeList from './WorktreeList'
import SidebarToolbar from './SidebarToolbar'
import WorktreeMetaDialog from './WorktreeMetaDialog'
import NonGitFolderDialog from './NonGitFolderDialog'
import RemoveFolderDialog from './RemoveFolderDialog'
import AddRepoDialog from './AddRepoDialog'
import AddProjectFromFolderDialog from './AddProjectFromFolderDialog'
import ProjectAddedDialog from './ProjectAddedDialog'
import WorktreeVisibilityDialog from './WorktreeVisibilityDialog'
import OrcaYamlTrustDialog from './OrcaYamlTrustDialog'
import type { VirtualizedScrollAnchor } from '@/hooks/useVirtualizedScrollAnchor'
import { cn } from '@/lib/utils'
import { FolderPlus, Loader2 } from 'lucide-react'
import { useSidebarProjectDrop } from './useSidebarProjectDrop'

const MIN_WIDTH = 220
const MAX_WIDTH = 500
// Why: match the right sidebar's 4px resize target; a 1px seam is too hard to acquire.
export const WORKTREE_SIDEBAR_RESIZE_HANDLE_CLASS_NAME =
  'absolute top-0 right-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-ring/20 active:bg-ring/30'

type SidebarProps = {
  worktreeScrollOffsetRef: React.MutableRefObject<number>
  worktreeScrollAnchorRef: React.MutableRefObject<VirtualizedScrollAnchor>
}

function Sidebar({
  worktreeScrollOffsetRef,
  worktreeScrollAnchorRef
}: SidebarProps): React.JSX.Element {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const sidebarWidth = useAppStore((s) => s.sidebarWidth)
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth)
  const repos = useAppStore((s) => s.repos)
  const fetchAllWorktrees = useAppStore((s) => s.fetchAllWorktrees)
  const spaces = useAppStore((s) => s.spaces)
  const reorderSpaces = useAppStore((s) => s.reorderSpaces)

  // Why: 4px matches the tab-reorder + repo-reorder thresholds elsewhere in the
  // sidebar so click-to-switch on a tab still fires without engaging dnd-kit on
  // tiny accidental movements.
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 4 }
  })
  const sensors = useSensors(pointerSensor)

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over) {
        return
      }
      const activeKind = active.data.current?.kind
      const overKind = over.data.current?.kind

      // Space tab reorder — active.id and over.id are Space ids inside the
      // SortableContext. Build the new order by swapping active into over's
      // index in the current sorted-by-order list. Repo→Space drops do not
      // come through here — those use native HTML5 drag handled in SpaceTab.
      if (activeKind === 'tab' && overKind === 'tab' && active.id !== over.id) {
        const sortedIds = [...spaces].sort((a, b) => a.order - b.order).map((s) => s.id)
        const fromIndex = sortedIds.indexOf(String(active.id))
        const toIndex = sortedIds.indexOf(String(over.id))
        if (fromIndex < 0 || toIndex < 0) {
          return
        }
        const next = sortedIds.slice()
        next.splice(fromIndex, 1)
        next.splice(toIndex, 0, String(active.id))
        reorderSpaces(next)
      }
    },
    [reorderSpaces, spaces]
  )

  const { nativeDropTarget, dropHandlers, affordance } = useSidebarProjectDrop()

  const setLiveSidebarWidth = React.useCallback((width: number) => {
    document.documentElement.style.setProperty('--workspace-sidebar-live-width', `${width}px`)
  }, [])

  // Fetch worktrees when repos are added/removed
  const repoCount = repos.length
  useEffect(() => {
    if (repoCount > 0) {
      fetchAllWorktrees()
    }
  }, [repoCount, fetchAllWorktrees])

  const { containerRef, onResizeStart } = useSidebarResize<HTMLDivElement>({
    isOpen: sidebarOpen,
    width: sidebarWidth,
    minWidth: MIN_WIDTH,
    maxWidth: MAX_WIDTH,
    deltaSign: 1,
    setWidth: setSidebarWidth,
    onDraftWidthChange: setLiveSidebarWidth
  })

  return (
    <TooltipProvider delayDuration={400}>
      <div
        ref={containerRef}
        data-native-file-drop-target={sidebarOpen ? nativeDropTarget : undefined}
        className="relative min-h-0 flex-shrink-0 bg-sidebar flex flex-col overflow-hidden scrollbar-sleek-parent"
        {...dropHandlers}
      >
        {sidebarOpen && (
          <>
            {/* Fixed controls */}
            <SidebarNav />

            <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
              <SpaceTabs />
              <SidebarHeader />

              <WorktreeList
                scrollOffsetRef={worktreeScrollOffsetRef}
                scrollAnchorRef={worktreeScrollAnchorRef}
              />
            </DndContext>

            <SetupScriptPromptCard />

            {/* Fixed bottom toolbar */}
            <SidebarToolbar />
          </>
        )}

        {sidebarOpen && affordance.visible ? (
          <div
            className={cn(
              'pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-1.5 rounded-md border bg-sidebar-accent/95 px-4 text-center text-sidebar-accent-foreground shadow-xs',
              affordance.tone === 'blocked' ? 'border-destructive/70' : 'border-sidebar-ring/70'
            )}
          >
            {affordance.tone === 'busy' ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            ) : (
              <FolderPlus className="size-5 text-muted-foreground" />
            )}
            <div className="text-sm font-medium">{affordance.label}</div>
            <div className="text-xs text-muted-foreground">{affordance.description}</div>
          </div>
        ) : null}

        {/* Resize handle */}
        {sidebarOpen && (
          <div
            data-sidebar-resize-handle=""
            className={WORKTREE_SIDEBAR_RESIZE_HANDLE_CLASS_NAME}
            onMouseDown={onResizeStart}
          />
        )}
      </div>

      {/* Dialog (rendered outside sidebar to avoid clipping) */}
      <WorktreeMetaDialog />
      <NonGitFolderDialog />
      <RemoveFolderDialog />
      <AddRepoDialog />
      <AddProjectFromFolderDialog />
      <ProjectAddedDialog />
      <WorktreeVisibilityDialog />
      <OrcaYamlTrustDialog />
    </TooltipProvider>
  )
}

export default React.memo(Sidebar)
