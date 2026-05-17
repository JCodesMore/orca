// Why: mix against --sidebar (a defined token) instead of transparent so the
// result is a solid color; downstream state overlays (active darkening, hover)
// then composite predictably on top in both light and dark mode.
export const REPO_TINT_PERCENT = 4
export const LINEAGE_REPO_TINT_PERCENT = 3

export function getRepoTintBackground(
  badgeColor: string,
  percent: number = REPO_TINT_PERCENT
): string {
  return `color-mix(in srgb, ${badgeColor} ${percent}%, var(--sidebar))`
}
