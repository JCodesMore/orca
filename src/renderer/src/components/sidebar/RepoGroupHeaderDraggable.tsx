import React, { useCallback, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import RepoMoveToSpaceMenu from './RepoMoveToSpaceMenu'
import { writeRepoDragData } from './repo-drag-types'

type Props = {
  repoId: string
  children: React.ReactNode
}

// Why: uses native HTML5 drag (not dnd-kit) so this gesture shares the same
// event system as the worktree-card kanban drag — both then route through
// SpaceTab's HTML5 drop handlers. dnd-kit's useDraggable here was unreachable
// in practice because the inner folder-icon stops pointer propagation for its
// own reorder controller.
export default function RepoGroupHeaderDraggable({ repoId, children }: Props): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPoint, setMenuPoint] = useState({ x: 0, y: 0 })

  const onContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    setMenuPoint({ x: event.clientX - bounds.left, y: event.clientY - bounds.top })
    setMenuOpen(true)
  }, [])

  const onDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      writeRepoDragData(event.dataTransfer, repoId)
    },
    [repoId]
  )

  return (
    <div
      className="relative"
      draggable
      onDragStart={onDragStart}
      onContextMenu={onContextMenu}
    >
      {children}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            aria-hidden
            tabIndex={-1}
            className="pointer-events-none absolute size-px opacity-0"
            style={{ left: menuPoint.x, top: menuPoint.y }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-52" sideOffset={0} align="start">
          <RepoMoveToSpaceMenu repoId={repoId} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
