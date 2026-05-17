// Why: project headers and Space tabs use native HTML5 drag-and-drop (not
// dnd-kit) so the gesture lives in the same event system as the existing
// worktree-card kanban drag. This module owns the repo-id payload used when a
// project header is dragged onto a Space tab.

export const ORCA_REPO_DRAG_TYPE = 'application/x-orca-repo-id'

export function writeRepoDragData(dataTransfer: DataTransfer, repoId: string): void {
  dataTransfer.effectAllowed = 'move'
  dataTransfer.setData(ORCA_REPO_DRAG_TYPE, repoId)
  // Why: a text/plain fallback keeps the drag intelligible to other surfaces
  // (Electron's outer chrome, debug tooling) that don't recognize the custom
  // MIME type but can still show a useful label.
  dataTransfer.setData('text/plain', repoId)
}

export function readRepoDragId(dataTransfer: DataTransfer): string | null {
  const typed = dataTransfer.getData(ORCA_REPO_DRAG_TYPE)
  return typed.length > 0 ? typed : null
}

export function hasRepoDragData(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(ORCA_REPO_DRAG_TYPE)
}
