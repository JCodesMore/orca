import React, { useCallback, useEffect, useRef, useState } from 'react'
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
import { hasRepoDragData } from './repo-drag-types'
import { hasWorkspaceDragData } from './workspace-status'

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
  /** Unread agent-event count to render as a trailing chip when > 0. For a
   *  Space, this is the per-Space total; for the "All Projects" pill, this
   *  is the grand total across every repo (assigned + unassigned), matching
   *  the Activity titlebar count. */
  notificationCount?: number
}

function formatNotificationCount(count: number): string {
  return count >= 100 ? '99+' : String(count)
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
  onRenameCancel,
  notificationCount = 0
}: SpaceTabProps): React.JSX.Element {
  const isAllProjects = space === null

  const sortable = useSortable({
    id: space?.id ?? '__all_projects__',
    data: { kind: 'tab' as const, spaceId: space?.id ?? null },
    disabled: isAllProjects
  })

  const [isDragOver, setIsDragOver] = useState(false)
  // Why: the actual drop is committed by useSpaceTabDocumentDrop in capture
  // phase (preload's drop listener stopPropagation()s the bubble path).
  // dragend on the source still propagates normally, so it's a reliable
  // signal to clear the highlight after the drop completes or is cancelled.
  useEffect(() => {
    const onDragEnd = (): void => setIsDragOver(false)
    document.addEventListener('dragend', onDragEnd, true)
    return () => document.removeEventListener('dragend', onDragEnd, true)
  }, [])
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
      if (!isAllProjects) {
        sortable.setNodeRef(node)
      }
    },
    [sortable, isAllProjects]
  )

  const acceptsDrag = useCallback((dataTransfer: DataTransfer) => {
    return hasRepoDragData(dataTransfer) || hasWorkspaceDragData(dataTransfer)
  }, [])

  const onDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!acceptsDrag(event.dataTransfer)) {
        return
      }
      // Why: preventDefault here tells the browser "this is a valid drop
      // target" — without it the cursor stays as the red "no drop" symbol
      // and onDrop never fires.
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (!isDragOver) {
        setIsDragOver(true)
      }
    },
    [acceptsDrag, isDragOver]
  )

  const onDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    // Why: dragleave fires when crossing into a child element too. Only clear
    // the highlight when the pointer truly leaves the tab.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return
    }
    setIsDragOver(false)
  }, [])

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
      data-space-drop-target={space?.id ?? 'all'}
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
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      {...(isAllProjects ? {} : sortable.attributes)}
      {...(isAllProjects || isRenaming ? {} : sortable.listeners)}
      className={cn(
        'group inline-flex h-7 shrink-0 cursor-pointer select-none items-center rounded-md px-2.5 text-[11px] font-medium transition-colors',
        isActive
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:text-foreground',
        isDragOver && 'ring-1 ring-sidebar-ring/60'
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
        <>
          <span className="truncate max-w-[140px]">{label}</span>
          {notificationCount > 0 ? (
            <span
              aria-label={`${notificationCount} unread`}
              className={cn(
                'ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium tabular-nums',
                // Why: re-tint on the active pill so the chip stays legible
                // against bg-sidebar-accent — `foreground/10` would all but
                // vanish there.
                isActive
                  ? 'bg-background/25 text-foreground'
                  : 'bg-foreground/10 text-foreground/80'
              )}
            >
              {formatNotificationCount(notificationCount)}
            </span>
          ) : null}
        </>
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
