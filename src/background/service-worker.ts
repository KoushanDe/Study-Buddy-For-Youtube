import type { Message } from '../shared/types/messages'
import {
  cacheNativeChapters,
  generateChapters,
  regenerateChapters,
} from '../services/chapters/chapter.service'
import { fetchTranscript } from '../services/transcript/transcript.service'
import { getChapterCache, getSettings, hashTranscript } from '../shared/storage/storage'
import { sendMessageToTab } from '../shared/messaging/send-message'
import type { Chapter, ChapterSource } from '../shared/types/chapter'

let activeYoutubeTabId: number | null = null
let lastVideoContext: Message & { type: 'VIDEO_CONTEXT' } | null = null

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (tab.url?.includes('youtube.com/watch')) {
      activeYoutubeTabId = tabId
    }
  })
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('youtube.com/watch')) {
    activeYoutubeTabId = tabId
  }
})

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  void handleMessage(message, sender, sendResponse)
  return true
})

// The MV3 service worker is ephemeral and loses in-memory state when it sleeps,
// so resolve the active YouTube watch tab on demand rather than relying solely
// on the cached id.
// Broadcasts coarse generation milestones to the popup so it can show a real,
// stage-anchored progress bar. The popup smooths motion between these floors.
function emitChapterProgress(videoId: string, progress: number, label: string): void {
  void chrome.runtime
    .sendMessage({ type: 'CHAPTER_PROGRESS', payload: { videoId, progress, label } })
    .catch(() => undefined)
}

async function getLiveVideoContext(
  tabId: number,
): Promise<{ videoId: string; title: string; durationSeconds: number } | null> {
  try {
    const live = await sendMessageToTab(tabId, { type: 'GET_VIDEO_CONTEXT' })
    if (live && typeof live === 'object' && 'videoId' in live) {
      const context = live as { videoId: string; title: string; durationSeconds: number }
      lastVideoContext = { type: 'VIDEO_CONTEXT', payload: context }
      return context
    }
  } catch {
    // fall through
  }
  return null
}

async function resolveYoutubeTabId(sender: chrome.runtime.MessageSender): Promise<number | null> {
  if (sender.tab?.id != null) return sender.tab.id

  if (activeYoutubeTabId != null) {
    try {
      const tab = await chrome.tabs.get(activeYoutubeTabId)
      if (tab?.url?.includes('youtube.com/watch')) return activeYoutubeTabId
    } catch {
      activeYoutubeTabId = null
    }
  }

  try {
    const tabs = await chrome.tabs.query({ url: '*://www.youtube.com/watch*' })
    const tab = tabs.find((t) => t.active) ?? tabs[0]
    if (tab?.id != null) {
      activeYoutubeTabId = tab.id
      return tab.id
    }
  } catch {
    // fall through
  }

  return null
}

async function handleMessage(
  message: Message,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
): Promise<void> {
  try {
    switch (message.type) {
      case 'VIDEO_CONTEXT': {
        if (sender.tab?.id) activeYoutubeTabId = sender.tab.id
        lastVideoContext = message
        void chrome.runtime.sendMessage(message).catch(() => undefined)
        sendResponse({ ok: true })
        return
      }

      case 'GET_VIDEO_CONTEXT': {
        const tabId = await resolveYoutubeTabId(sender)
        if (!tabId) {
          sendResponse(null)
          return
        }

        const live = await getLiveVideoContext(tabId)
        sendResponse(live)
        return
      }

      case 'GENERATE_CHAPTERS': {
        const settings = await getSettings()
        if (!settings.enabled) {
          sendResponse({ error: 'Extension is disabled in settings' })
          return
        }

        const tabId = await resolveYoutubeTabId(sender)
        if (!tabId) {
          sendResponse({ error: 'No active YouTube tab' })
          return
        }

        const liveContext = await getLiveVideoContext(tabId)
        const videoId = liveContext?.videoId ?? message.payload.videoId
        const title = liveContext?.title ?? message.payload.title
        const durationSeconds = liveContext?.durationSeconds ?? message.payload.durationSeconds

        const cachedWithoutTranscript = await getChapterCache(videoId)
        if (cachedWithoutTranscript && !cachedWithoutTranscript.transcriptHash) {
          sendResponse({
            chapters: cachedWithoutTranscript.chapters,
            source: 'ai' satisfies ChapterSource,
            cached: true,
          })
          return
        }

        emitChapterProgress(videoId, 8, 'Checking YouTube chapters…')
        const nativeChapters = await getNativeChapters(tabId)
        if (nativeChapters.length >= 2) {
          const result = await cacheNativeChapters(videoId, nativeChapters)
          emitChapterProgress(videoId, 100, 'Done')
          sendResponse({ ...result, cached: false })
          return
        }

        emitChapterProgress(videoId, 15, 'Reading transcript…')
        const transcriptResult = await getTranscriptForChapters(videoId)
        if ('error' in transcriptResult) {
          sendResponse({ error: transcriptResult.error })
          return
        }

        const transcriptHash = hashTranscript(transcriptResult.text)
        const cached = await getChapterCache(videoId, transcriptHash)
        if (cached) {
          sendResponse({ chapters: cached.chapters, source: cached.source, cached: true })
          return
        }

        emitChapterProgress(videoId, 40, 'Generating chapters…')
        const result = await generateChapters(
          transcriptResult,
          title,
          durationSeconds,
        )
        emitChapterProgress(videoId, 100, 'Done')
        sendResponse({ ...result, cached: false })
        return
      }

      case 'INVALIDATE_CHAPTER_CACHE': {
        const { videoId } = message.payload

        emitChapterProgress(videoId, 15, 'Reading transcript…')
        const transcriptResult = await getTranscriptForChapters(videoId)
        if ('error' in transcriptResult) {
          sendResponse({ error: transcriptResult.error })
          return
        }

        emitChapterProgress(videoId, 40, 'Generating chapters…')
        const result = await regenerateChapters(
          transcriptResult,
          lastVideoContext?.payload.title ?? 'YouTube Video',
          lastVideoContext?.payload.durationSeconds ?? 0,
        )
        emitChapterProgress(videoId, 100, 'Done')
        sendResponse({ ...result, cached: false })
        return
      }

      case 'SEEK_TO': {
        const tabId = await resolveYoutubeTabId(sender)
        if (!tabId) {
          sendResponse({ error: 'No active YouTube tab' })
          return
        }
        await sendMessageToTab(tabId, message)
        sendResponse({ ok: true })
        return
      }

      default:
        sendResponse({ ok: true })
    }
  } catch (error) {
    sendResponse({ error: error instanceof Error ? error.message : 'Unknown error' })
  }
}

async function getNativeChapters(tabId: number): Promise<Chapter[]> {
  const response = (await sendMessageToTab(tabId, { type: 'GET_NATIVE_CHAPTERS' })) as {
    chapters?: Chapter[]
  }
  return response.chapters ?? []
}

async function getTranscriptForChapters(videoId: string) {
  try {
    return await fetchTranscript(videoId)
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to load transcript' } as const
  }
}

export {}
