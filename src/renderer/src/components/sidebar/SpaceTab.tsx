import React, { useCallback, useEffect, useRef } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { Space } from '../../../../shared/types'

export type SpaceTabDropData = { kind: 'space'; spaceId: string | null }

type SpaceTabProps = {
  // null means the permanent "All Projects" tab.
  space: Space | null
  isActive: boolean
  onActivate: () => void
  onRequestRename?: () => void
  onRequestDelete?: () => void
  isRenaming?: boolean
  renameValue?: string
  onRenameChange?: (value: string) => void
  onRenameCommit?: () => void
  onRenameCancel?: () => void
}

const ALL_PROJECTS_LABEL = 'All Projects'

export default function SpaceTab({
  space,
  isActive,
  onActivate,
  onRequestRename,
  onRequestDelete,
  isRenaming,
  renameValue,
  onRenameChange,
  onRenameCommit,
  onRenameCancel
}: SpaceTabProps): React.JSX.Element {
  const isAllProjects = space === null
  // Why: All Projects is rendered outside the SortableContext and never
  // reorders, so it only needs a droppable target. User Spaces wrap both so
  // they can be reordered AND accept dropped repos.
  const droppableId = isAllProjects ? 'space-drop-all' : `space-drop-${space.id}`
  const dropData: SpaceTabDropData = { kind: 'space', spaceId: space?.id ?? null }

  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: droppableId,
    data: dropData
  })

  const sortable = useSortable({
    id: space?.id ?? '__all_projects__',
    data: { kind: 'tab' as const, spaceId: space?.id ?? null },
    disabled: isAllProjects
  })

  const renameInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!isRenaming) {
      return
    }
    const frame = requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [isRenaming])

  const setRefs = useCallback(
    (node: HTMLElement | null) => {
      setDroppableRef(node)
      if (!isAllProjects) {
        sortable.setNodeRef(node)
      }
    },
    [setDroppableRef, sortable, isAllProjects]
  )

  const style: React.CSSProperties = isAllProjects
    ? {}
    : {
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        opacity: sortable.isDragging ? 0.5 : 1
      }

  const label = isAllProjects ? ALL_PROJECTS_LABEL : space.name

  const tab = (
    <div
      ref={setRefs}
      style={style}
      data-active={isActive ? 'true' : 'false'}
      data-space-id={space?.id ?? 'all'}
      onClick={() => {
        if (isRenaming) {
          return
        }
        onActivate()
      }}
      onDoubleClick={() => {
        if (isAllProjects || !onRequestRename) {
          return
        }
        onRequestRename()
      }}
      {...(isAllProjects ? {} : sortable.attributes)}
      {...(isAllProjects || isRenaming ? {} : sortable.listeners)}
      className={cn(
        'group inline-flex h-7 shrink-0 cursor-pointer select-none items-center rounded-md px-2.5 text-[11px] font-medium transition-colors',
        isActive
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:text-foreground',
        isOver && 'ring-1 ring-sidebar-ring/60'
      )}
    >
      {isRenaming ? (
        <Input
          ref={renameInputRef}
          value={renameValue ?? ''}
          onChange={(e) => onRenameChange?.(e.target.value)}
          onBlur={() => onRenameCommit?.()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onRenameCommit?.()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onRenameCancel?.()
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="h-5 w-[96px] min-w-[96px] max-w-[96px] px-1 py-0 text-[11px]"
          spellCheck={false}
          aria-label={`Rename Space ${space?.name ?? ''}`}
        />
      ) : (
        <span className="truncate max-w-[140px]">{label}</span>
      )}
    </div>
  )

  if (isAllProjects) {
    return tab
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{tab}</ContextMenuTrigger>
      <ContextMenuContent className="w-40">
        <ContextMenuItem
          onSelect={() => {
            onRequestRename?.()
          }}
        >
          Rename
        </ContextMenuItem>
        <ContextMenuItem
          variant="destructive"
          onSelect={() => {
            onRequestDelete?.()
          }}
        >
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
