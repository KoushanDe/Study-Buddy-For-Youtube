import { getVideoId } from '../../shared/utils/youtube-url'
import { isExtensionContextValid } from '../../shared/utils/extension-context'
import { sendMessage } from '../../shared/messaging/send-message'
import { chaptersNeedRefresh } from '../../services/chapters/chapter-page-state'
import { extractNativeYouTubeChapters } from '../../services/chapters/youtube-native-chapters'
import { fetchTranscriptFromPage } from '../../services/transcript/transcript-bridge'
import type { Message } from '../../shared/types/messages'

function getVideoTitle(): string {
  const titleEl =
    document.querySelector<HTMLElement>('h1.ytd-watch-metadata yt-formatted-string') ??
    document.querySelector<HTMLElement>('h1 yt-formatted-string')
  return titleEl?.textContent?.trim() ?? 'YouTube Video'
}

function getVideoDurationSeconds(): number {
  const video = document.querySelector<HTMLVideoElement>('video.html5-main-video, video')
  if (!video || !Number.isFinite(video.duration)) return 0
  return Math.floor(video.duration)
}

function waitForVideoMetadata(): Promise<number> {
  return new Promise((resolve) => {
    const video = document.querySelector<HTMLVideoElement>('video.html5-main-video, video')
    if (!video) {
      resolve(0)
      return
    }

    if (video.readyState >= 1 && Number.isFinite(video.duration)) {
      resolve(Math.floor(video.duration))
      return
    }

    const onLoaded = () => {
      video.removeEventListener('loadedmetadata', onLoaded)
      resolve(Math.floor(video.duration) || 0)
    }
    video.addEventListener('loadedmetadata', onLoaded)

    setTimeout(() => resolve(getVideoDurationSeconds()), 3000)
  })
}

function publishVideoContext(): void {
  if (!isExtensionContextValid()) return

  const videoId = getVideoId()
  if (!videoId) return

  void sendMessage({
    type: 'VIDEO_CONTEXT',
    payload: {
      videoId,
      title: getVideoTitle(),
      durationSeconds: getVideoDurationSeconds(),
      needsRefresh: chaptersNeedRefresh(),
    },
  })
}

export async function initVideoPageBridge(): Promise<() => void> {
  const videoId = getVideoId()
  if (!videoId) return () => undefined

  publishVideoContext()

  void waitForVideoMetadata().then(() => publishVideoContext())

  const onNavigate = () => {
    publishVideoContext()
    void waitForVideoMetadata().then(() => publishVideoContext())
  }
  document.addEventListener('yt-navigate-finish', onNavigate)

  const onMessage = (
    message: Message,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => {
    if (message.type === 'SEEK_TO' && message.payload) {
      const video = document.querySelector<HTMLVideoElement>('video.html5-main-video, video')
      if (video) {
        video.currentTime = message.payload.seconds
        video.play().catch(() => undefined)
      }
      sendResponse({ ok: true })
      return true
    }

    if (message.type === 'GET_NATIVE_CHAPTERS') {
      const expectedVideoId = message.payload.videoId
      const currentVideoId = getVideoId()
      if (expectedVideoId && currentVideoId && expectedVideoId !== currentVideoId) {
        sendResponse({ chapters: [] })
        return true
      }

      const chapters = extractNativeYouTubeChapters()
      sendResponse({ chapters: chapters ?? [] })
      return true
    }

    if (message.type === 'GET_VIDEO_CONTEXT') {
      const currentVideoId = getVideoId()
      if (!currentVideoId) {
        sendResponse(null)
        return true
      }

      sendResponse({
        videoId: currentVideoId,
        title: getVideoTitle(),
        durationSeconds: getVideoDurationSeconds(),
        needsRefresh: chaptersNeedRefresh(),
      })
      return true
    }

    if (message.type === 'FETCH_TRANSCRIPT' && message.payload?.videoId) {
      void fetchTranscriptFromPage(message.payload.videoId)
        .then((result) => sendResponse({ result }))
        .catch((error: unknown) => {
          const errorMessage = error instanceof Error ? error.message : 'Failed to load transcript'
          sendResponse({ error: errorMessage })
        })
      return true
    }

    return undefined
  }

  chrome.runtime.onMessage.addListener(onMessage)

  return () => {
    document.removeEventListener('yt-navigate-finish', onNavigate)
    chrome.runtime.onMessage.removeListener(onMessage)
  }
}
