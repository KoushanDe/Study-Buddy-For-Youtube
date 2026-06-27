import { isExtensionContextValid } from '../../shared/utils/extension-context'
import { sendMessage } from '../../shared/messaging/send-message'
import { hasPlaylistDetails } from '../../shared/utils/playlist-details'
import { getPlaylistId } from '../../shared/utils/youtube-url'
import { PlaylistObserver } from './playlist-observer'
import type { PlaylistDurationResult } from '../../shared/types/playlist'

let observer: PlaylistObserver | null = null
let activePlaylistId: string | null = null
let latestResult: PlaylistDurationResult | null = null

export function startPlaylistScanner(playlistId: string): () => void {
  stopPlaylistScanner()

  activePlaylistId = playlistId
  observer = new PlaylistObserver(playlistId, (result) => {
    if (getPlaylistId() !== playlistId) return

    latestResult = result
    if (!isExtensionContextValid()) return

    void sendMessage({ type: 'PLAYLIST_DURATIONS_UPDATED', payload: result })
  })
  observer.start()

  return stopPlaylistScanner
}

export function stopPlaylistScanner(): void {
  observer?.stop()
  observer = null
  activePlaylistId = null
  latestResult = null
}

export function getLatestPlaylistDuration(playlistId?: string): PlaylistDurationResult | null {
  const currentId = getPlaylistId()
  const expectedId = playlistId ?? currentId

  if (!latestResult || !expectedId) return null
  if (latestResult.playlistId !== expectedId) return null
  if (currentId && latestResult.playlistId !== currentId) return null
  if (!hasPlaylistDetails(latestResult)) return null

  return latestResult
}

export function getActivePlaylistScannerId(): string | null {
  return activePlaylistId
}
