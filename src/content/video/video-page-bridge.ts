import { getVideoId } from '../../shared/utils/youtube-url'
import { sendMessage } from '../../shared/messaging/send-message'
import { extractNativeYouTubeChapters } from '../../services/chapters/youtube-native-chapters'

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

export async function initVideoPageBridge(): Promise<() => void> {
  const videoId = getVideoId()
  if (!videoId) return () => undefined

  const publishVideoContext = () => {
    const currentVideoId = getVideoId()
    if (!currentVideoId) return

    void sendMessage({
      type: 'VIDEO_CONTEXT',
      payload: {
        videoId: currentVideoId,
        title: getVideoTitle(),
        durationSeconds: getVideoDurationSeconds(),
      },
    })
  }

  publishVideoContext()

  void waitForVideoMetadata().then(() => {
    publishVideoContext()
  })

  const onMessage = (
    message: { type: string; payload?: { seconds: number; videoId: string } },
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
      })
      return true
    }

    return undefined
  }

  chrome.runtime.onMessage.addListener(onMessage)

  return () => {
    chrome.runtime.onMessage.removeListener(onMessage)
  }
}
