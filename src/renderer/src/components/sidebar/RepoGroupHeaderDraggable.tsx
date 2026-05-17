import React, { useCallback, useRef, useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import RepoMoveToSpaceMenu from './RepoMoveToSpaceMenu'

type Props = {
  repoId: string
  children: React.ReactNode
}

// Wraps a repo group header so it can be dragged onto a Space tab AND
// right-clicked for "Move to Space ▸ …". The pointer-down listener from
// dnd-kit is applied at this wrapper level; the existing folder-icon
// reorder drag stops propagation to keep its own threshold authoritative.
export default function RepoGroupHeaderDraggable({ repoId, children }: Props): React.JSX.Element {
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: `repo-${repoId}`,
    data: { kind: 'repo', repoId }
  })

  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPoint, setMenuPoint] = useState({ x: 0, y: 0 })
  const scopeRef = useRef<HTMLDivElement>(null)

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node)
      scopeRef.current = node
    },
    [setNodeRef]
  )

  const onContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    setMenuPoint({ x: event.clientX - bounds.left, y: event.clientY - bounds.top })
    setMenuOpen(true)
  }, [])

  return (
    <div
      ref={setRefs}
      className="relative"
      onContextMenu={onContextMenu}
      {...listeners}
      {...attributes}
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
