import React, { useCallback } from 'react'
import { Check, FolderInput } from 'lucide-react'
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/store'

type Props = {
  repoId: string
  // Why: this submenu is reused for both the repo group header (single-repo
  // context) and the worktree card (per-worktree context). The label clarifies
  // intent for the latter where the action target isn't obvious.
  label?: string
}

export default function RepoMoveToSpaceMenu({
  repoId,
  label = 'Move to Space'
}: Props): React.JSX.Element {
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
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <FolderInput className="size-3.5" />
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-44">
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
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
