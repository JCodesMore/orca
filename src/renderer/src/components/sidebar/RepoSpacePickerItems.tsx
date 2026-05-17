import React, { useCallback } from 'react'
import { Check } from 'lucide-react'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/store'

type Props = {
  repoId: string
}

// Why: shared between the right-click "Move to Space" submenu and the
// click-to-open "Add to Space" picker so both surfaces always offer the same
// destinations and selection markers from a single source of truth.
export default function RepoSpacePickerItems({ repoId }: Props): React.JSX.Element {
  const spaces = useAppStore((s) => s.spaces)
  const repoSpaceAssignments = useAppStore((s) => s.repoSpaceAssignments)
  const moveRepoToSpace = useAppStore((s) => s.moveRepoToSpace)

  const currentSpaceId = repoSpaceAssignments[repoId] ?? null
  const sortedSpaces = React.useMemo(() => [...spaces].sort((a, b) => a.order - b.order), [spaces])

  const handleMove = useCallback(
    (spaceId: string | null) => {
      moveRepoToSpace(repoId, spaceId)
    },
    [moveRepoToSpace, repoId]
  )

  return (
    <>
      <DropdownMenuItem onSelect={() => handleMove(null)}>
        <span className="inline-flex size-3.5 items-center justify-center">
          {currentSpaceId === null ? <Check className="size-3" /> : null}
        </span>
        All Projects
      </DropdownMenuItem>
      {sortedSpaces.length > 0 ? <DropdownMenuSeparator /> : null}
      {sortedSpaces.map((space) => (
        <DropdownMenuItem key={space.id} onSelect={() => handleMove(space.id)}>
          <span className="inline-flex size-3.5 items-center justify-center">
            {currentSpaceId === space.id ? <Check className="size-3" /> : null}
          </span>
          <span className="truncate">{space.name}</span>
        </DropdownMenuItem>
      ))}
    </>
  )
}
