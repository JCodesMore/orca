import React from 'react'
import { FolderInput } from 'lucide-react'
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import RepoSpacePickerItems from './RepoSpacePickerItems'

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
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <FolderInput className="size-3.5" />
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-44">
        <RepoSpacePickerItems repoId={repoId} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
