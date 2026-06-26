export function getAvailableVideoCount(
  totalCount: number | null,
  hiddenCount: number | null,
): number | null {
  if (totalCount === null) return null
  if (hiddenCount === null || hiddenCount <= 0) return totalCount
  return Math.max(0, totalCount - hiddenCount)
}

export function inferHiddenCount(
  totalCount: number | null,
  loadedCount: number,
): number | null {
  if (totalCount === null || loadedCount >= totalCount) return null
  return totalCount - loadedCount
}

export function isPlaylistScanComplete(params: {
  loadedCount: number
  totalCount: number | null
  hiddenCount: number | null
  scrolledToEnd: boolean
  stablePolls: number
}): boolean {
  const { loadedCount, totalCount, hiddenCount, scrolledToEnd, stablePolls } = params

  if (loadedCount === 0) return false

  const available = getAvailableVideoCount(totalCount, hiddenCount)
  if (available !== null && loadedCount >= available) return true

  if (totalCount !== null && loadedCount >= totalCount) return true

  // Scrolled through the whole list and count stopped changing — remaining
  // entries are hidden or unavailable in the DOM.
  if (scrolledToEnd && stablePolls >= 2) return true

  return false
}
