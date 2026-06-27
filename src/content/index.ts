import { getPlaylistId, isPlaylistPage, isWatchPage } from '../shared/utils/youtube-url'
import { isExtensionContextValid } from '../shared/utils/extension-context'
import { getSettings } from '../shared/storage/storage'
import { markPlaylistHintShown, shouldShowPlaylistHint } from '../shared/utils/playlist-hint-session'
import {
  getActivePlaylistScannerId,
  getLatestPlaylistDuration,
  startPlaylistScanner,
  stopPlaylistScanner,
} from './playlist/playlist-scanner'
import { mountPlaylistHint, unmountPlaylistHint } from './playlist/mount-playlist-hint'
import { initChapterPageState } from '../services/chapters/chapter-page-state'
import { initVideoPageBridge } from './video/video-page-bridge'
import { listenForPlayerResponse } from '../services/transcript/player-response-bridge'
import { installTranscriptFetchProxy } from '../services/transcript/transcript-fetch-proxy'
import type { Message } from '../shared/types/messages'

let cleanup: (() => void) | null = null
let hintCleanup: (() => void) | null = null
let stopPlayerResponseListener: (() => void) | null = null
let stopTranscriptFetchProxy: (() => void) | null = null
let lastHref = location.href
let restartTimer: ReturnType<typeof setTimeout> | null = null

function ensureTranscriptFetchProxy(): void {
  if (stopTranscriptFetchProxy) return
  stopTranscriptFetchProxy = installTranscriptFetchProxy()
}

function ensurePlayerResponseBridge(): void {
  if (stopPlayerResponseListener) return
  stopPlayerResponseListener = listenForPlayerResponse(() => {})
}

async function initForCurrentPage(): Promise<void> {
  if (!isExtensionContextValid()) return

  try {
    if (restartTimer) {
      clearTimeout(restartTimer)
      restartTimer = null
    }

    cleanup?.()
    cleanup = null
    hintCleanup?.()
    hintCleanup = null
    stopPlaylistScanner()
    unmountPlaylistHint()

    const settings = await getSettings()
    if (!settings.enabled) return

    if (isPlaylistPage()) {
      const playlistId = getPlaylistId()
      if (!playlistId) return

      if (getActivePlaylistScannerId() === playlistId) return

      cleanup = startPlaylistScanner(playlistId)

      if (shouldShowPlaylistHint()) {
        hintCleanup = mountPlaylistHint()
        markPlaylistHintShown()
      }
      return
    }

    if (isWatchPage()) {
      ensurePlayerResponseBridge()
      cleanup = await initVideoPageBridge()
    }
  } catch {
    // Extension may have reloaded while YouTube kept the old content script alive.
  }
}

function onNavigation(): void {
  if (!isExtensionContextValid()) return

  const href = location.href
  if (href === lastHref) return
  lastHref = href
  void initForCurrentPage()
}

function setupNavigationListener(): void {
  document.addEventListener('yt-navigate-finish', onNavigation)
  setInterval(() => {
    if (!isExtensionContextValid()) return
    if (location.href !== lastHref) onNavigation()
  }, 1000)
}

function setupSettingsListener(): void {
  if (!isExtensionContextValid()) return

  chrome.storage.onChanged.addListener((changes, area) => {
    if (!isExtensionContextValid()) return
    if (area !== 'local' || !changes.settings) return
    void initForCurrentPage()
  })
}

function setupMessageListener(): void {
  if (!isExtensionContextValid()) return

  chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
    if (message.type === 'GET_PLAYLIST_DURATION') {
      const playlistId = message.payload?.playlistId
      sendResponse({ result: getLatestPlaylistDuration(playlistId) })
      return true
    }
    return false
  })
}

initChapterPageState()
void initForCurrentPage()
ensureTranscriptFetchProxy()
setupNavigationListener()
setupSettingsListener()
setupMessageListener()

export {}
