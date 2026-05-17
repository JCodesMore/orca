import React from 'react'
import { Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import RepoSpacePickerItems from './RepoSpacePickerItems'

type Props = {
  repoId: string
}

// Why: only rendered for repos with no space assignment in the All Projects
// view. Shares geometry with the assigned-space pill (same slot, same height)
// so adjacent repo rows align; the dashed border distinguishes "empty slot you
// can fill" from "already assigned to X".
export default function RepoAddToSpaceButton({ repoId }: Props): React.JSX.Element {
  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Badge
              variant="outline"
              role="button"
              tabIndex={0}
              aria-label="Add to space"
              className="h-[16px] shrink-0 cursor-pointer gap-0.5 rounded border-dashed border-foreground/25 bg-transparent px-1.5 text-[10px] font-medium leading-none text-foreground/60 transition-colors hover:border-foreground/40 hover:bg-foreground/[0.06] hover:text-foreground"
              onClick={(e) => {
                // Why: the parent repo-header row's onClick toggles group
                // collapse — stopPropagation keeps the click scoped to the
                // dropdown trigger.
                e.stopPropagation()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation()
                }
              }}
            >
              <Plus className="size-2.5" strokeWidth={2.5} />
              Add
            </Badge>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          Add to space
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        className="w-44"
        align="start"
        sideOffset={4}
        onClick={(e) => e.stopPropagation()}
      >
        <RepoSpacePickerItems repoId={repoId} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
