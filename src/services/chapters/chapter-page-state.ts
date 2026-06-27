import { getVideoId } from '../../shared/utils/youtube-url'

let pageVideoId: string | null = null
let needsRefresh = false
let initialized = false

/** Call once when the content script first loads (full page load). */
export function initChapterPageState(): void {
  if (initialized) return
  initialized = true

  pageVideoId = getVideoId()
  needsRefresh = false

  document.addEventListener('yt-navigate-finish', () => {
    const currentVideoId = getVideoId()
    if (!currentVideoId) return

    if (pageVideoId && pageVideoId !== currentVideoId) {
      needsRefresh = true
    }

    pageVideoId = currentVideoId
  })
}

export function chaptersNeedRefresh(): boolean {
  return needsRefresh
}
