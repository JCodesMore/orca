import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useAppStore } from '@/store'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Input } from '@/components/ui/input'
import SpaceTab from './SpaceTab'
import { useSpaceNotificationCounts } from './use-space-notification-counts'
import { useSpaceTabDocumentDrop } from './use-space-tab-drop'

type RenameState = { spaceId: string; value: string }

// Why: when the scroll content overflows, fade both edges so labels disappear
// gracefully instead of getting clipped mid-character. The left fade starts
// 12px in so the All Projects tab stays fully opaque at the leftmost edge.
const MASK_BOTH =
  'linear-gradient(to right, transparent 0px, black 12px, black calc(100% - 12px), transparent 100%)'

export default function SpaceTabs(): React.JSX.Element {
  const spaces = useAppStore((s) => s.spaces)
  const activeSpaceId = useAppStore((s) => s.activeSpaceId)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const addSpace = useAppStore((s) => s.addSpace)
  const renameSpace = useAppStore((s) => s.renameSpace)
  const deleteSpace = useAppStore((s) => s.deleteSpace)
  const notificationCounts = useSpaceNotificationCounts()

  useSpaceTabDocumentDrop()

  const [rename, setRename] = useState<RenameState | null>(null)
  const [creating, setCreating] = useState(false)
  const [createValue, setCreateValue] = useState('')
  // Why: chevrons only render when there's actual headroom to scroll in that
  // direction, so the affordance disappears at the edges instead of misleading.
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const createInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const outerRef = useRef<HTMLDivElement>(null)

  const sortedSpaces = React.useMemo(() => [...spaces].sort((a, b) => a.order - b.order), [spaces])
  const sortableIds = React.useMemo(() => sortedSpaces.map((s) => s.id), [sortedSpaces])

  useEffect(() => {
    if (!creating) {
      return
    }
    const frame = requestAnimationFrame(() => {
      createInputRef.current?.focus()
      createInputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [creating])

  // Why: only show the mask fades when content actually overflows; otherwise
  // the leftmost/rightmost tab would render visibly faded for no reason.
  const updateOverflow = useCallback(() => {
    const el = scrollRef.current
    const outer = outerRef.current
    if (!el || !outer) {
      return
    }
    const overflowing = el.scrollWidth > el.clientWidth + 1
    if (overflowing) {
      outer.dataset.overflow = 'true'
      outer.style.maskImage = MASK_BOTH
      outer.style.webkitMaskImage = MASK_BOTH
    } else {
      delete outer.dataset.overflow
      outer.style.maskImage = ''
      outer.style.webkitMaskImage = ''
    }
    setCanScrollLeft(overflowing && el.scrollLeft > 0)
    setCanScrollRight(overflowing && el.scrollLeft < el.scrollWidth - el.clientWidth - 1)
  }, [])

  useLayoutEffect(() => {
    updateOverflow()
  }, [updateOverflow, sortedSpaces.length])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    const onScroll = (): void => updateOverflow()
    el.addEventListener('scroll', onScroll, { passive: true })
    let ro: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => updateOverflow())
      ro.observe(el)
    }
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro?.disconnect()
    }
  }, [updateOverflow])

  // Why: vertical wheel deltas should pan the strip horizontally, matching the
  // same affordance the main TabBar uses — otherwise mouse-wheel users have no
  // way to traverse the bar without clicking the chevrons.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault()
        el.scrollLeft += e.deltaY
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const scrollByDirection = useCallback((dir: 1 | -1) => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    el.scrollBy({ left: dir * Math.floor(el.clientWidth * 0.6), behavior: 'smooth' })
  }, [])

  const handleCreateCommit = useCallback(() => {
    const trimmed = createValue.trim()
    if (trimmed.length === 0) {
      setCreating(false)
      setCreateValue('')
      return
    }
    const created = addSpace(trimmed)
    if (created) {
      setActiveSpace(created.id)
    }
    setCreating(false)
    setCreateValue('')
  }, [addSpace, createValue, setActiveSpace])

  const handleCreateCancel = useCallback(() => {
    setCreating(false)
    setCreateValue('')
  }, [])

  const handleRequestRename = useCallback((spaceId: string, currentName: string) => {
    setRename({ spaceId, value: currentName })
  }, [])

  const handleRenameCommit = useCallback(() => {
    if (!rename) {
      return
    }
    renameSpace(rename.spaceId, rename.value)
    setRename(null)
  }, [rename, renameSpace])

  const handleRenameCancel = useCallback(() => {
    setRename(null)
  }, [])

  return (
    // Why: clicks anywhere in the Space tabs strip must not dismiss the
    // open Workspace board — switching spaces keeps the board open.
    <div className="relative mt-2" data-workspace-board-preserve-open="">
      <div ref={outerRef} className="px-2" role="tablist" aria-label="Project Spaces">
        <div
          ref={scrollRef}
          className="flex items-center gap-1 overflow-x-auto scrollbar-none"
          style={{ scrollbarWidth: 'none' }}
        >
          <SpaceTab
            space={null}
            isActive={activeSpaceId === null}
            onActivate={() => setActiveSpace(null)}
          />
          <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
            {sortedSpaces.map((space) => (
              <SpaceTab
                key={space.id}
                space={space}
                isActive={activeSpaceId === space.id}
                onActivate={() => setActiveSpace(space.id)}
                onRequestRename={() => handleRequestRename(space.id, space.name)}
                onRequestDelete={() => deleteSpace(space.id)}
                isRenaming={rename?.spaceId === space.id}
                renameValue={rename?.spaceId === space.id ? rename.value : undefined}
                onRenameChange={(v) =>
                  setRename((prev) =>
                    prev && prev.spaceId === space.id ? { ...prev, value: v } : prev
                  )
                }
                onRenameCommit={handleRenameCommit}
                onRenameCancel={handleRenameCancel}
                notificationCount={notificationCounts[space.id] ?? 0}
              />
            ))}
          </SortableContext>
          {creating ? (
            <Input
              ref={createInputRef}
              value={createValue}
              placeholder="Space name"
              onChange={(e) => setCreateValue(e.target.value)}
              onBlur={handleCreateCommit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleCreateCommit()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  handleCreateCancel()
                }
              }}
              className="h-7 w-[120px] min-w-[120px] max-w-[120px] px-2 text-[11px]"
              spellCheck={false}
              aria-label="New Space name"
            />
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  aria-label="New Space"
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                >
                  <Plus className="size-3.5" strokeWidth={2.25} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                New Space
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      {canScrollLeft && (
        <button
          type="button"
          aria-label="Scroll spaces left"
          onClick={() => scrollByDirection(-1)}
          className="absolute left-0.5 top-1/2 z-20 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md bg-sidebar/80 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-sidebar hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" strokeWidth={2.25} />
        </button>
      )}
      {canScrollRight && (
        <button
          type="button"
          aria-label="Scroll spaces right"
          onClick={() => scrollByDirection(1)}
          className="absolute right-0.5 top-1/2 z-20 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md bg-sidebar/80 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-sidebar hover:text-foreground"
        >
          <ChevronRight className="size-3.5" strokeWidth={2.25} />
        </button>
      )}
    </div>
  )
}
