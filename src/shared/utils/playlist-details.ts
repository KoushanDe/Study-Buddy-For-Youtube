import type { PlaylistDurationResult } from '../types/playlist'

/** A playlist is "loaded" once we have a real title or at least one counted video. */
export function hasPlaylistContent(title: string | null | undefined, loadedCount: number): boolean {
  return Boolean(title?.trim()) || loadedCount > 0
}

export function hasPlaylistDetails(result: PlaylistDurationResult | null | undefined): boolean {
  if (!result) return false
  return hasPlaylistContent(result.title, result.loadedCount)
}
