import type { Message } from '../shared/types/messages'
import {
  cacheNativeChapters,
  generateChapters,
  regenerateChapters,
  getCachedChaptersIfValid,
} from '../services/chapters/chapter.service'
import {
  getChapterJobSnapshot,
  isChapterJobRunning,
  runDedupedChapterJob,
  clearChapterJobSnapshot,
  type ChapterGenerationResult,
} from '../services/chapters/chapter-generation-coordinator'
import { fetchTranscript } from '../services/transcript/transcript.service'
import { getChapterCache, getSettings, hashTranscript, markChapterCacheFeedbackSubmitted } from '../shared/storage/storage'
import { getOrCreateClientId } from '../shared/storage/client-id'
import {
  getRegenerateQuota,
  submitRegenerateFeedback,
} from '../services/chapters/chapter-api.client'
import { sendMessageToTab } from '../shared/messaging/send-message'
import type { Chapter } from '../shared/types/chapter'

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

function emitChapterProgress(videoId: string, progress: number, label: string): void {
  void chrome.runtime
    .sendMessage({ type: 'CHAPTER_PROGRESS', payload: { videoId, progress, label } })
    .catch(() => undefined)
}

type VideoContextPayload = {
  videoId: string
  title: string
  durationSeconds: number
  needsRefresh?: boolean
}

async function getLiveVideoContext(tabId: number): Promise<VideoContextPayload | null> {
  try {
    const live = await sendMessageToTab(tabId, { type: 'GET_VIDEO_CONTEXT' })
    if (live && typeof live === 'object' && 'videoId' in live) {
      const context = live as VideoContextPayload
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

async function getNativeChapters(tabId: number, videoId: string): Promise<Chapter[]> {
  try {
    const live = await getLiveVideoContext(tabId)
    if (live?.needsRefresh || (live && live.videoId !== videoId)) {
      return []
    }

    const response = (await sendMessageToTab(tabId, {
      type: 'GET_NATIVE_CHAPTERS',
      payload: { videoId },
    })) as { chapters?: Chapter[] }

    return response.chapters ?? []
  } catch {
    return []
  }
}

async function getTranscriptForChapters(videoId: string, tabId: number) {
  try {
    return await fetchTranscript(videoId, tabId)
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to load transcript' } as const
  }
}

async function executeChapterGeneration(
  videoId: string,
  title: string,
  durationSeconds: number,
  tabId: number,
  forceRegenerate: boolean,
  regenerateReason?: string,
): Promise<ChapterGenerationResult> {
  return runDedupedChapterJob(videoId, emitChapterProgress, async (onProgress) => {
    if (!forceRegenerate) {
      onProgress(8, 'Checking YouTube chapters…')
      const nativeChapters = await getNativeChapters(tabId, videoId)
      if (nativeChapters.length >= 2) {
        const result = await cacheNativeChapters(videoId, nativeChapters)
        return { ...result, cached: false }
      }
    }

    onProgress(15, 'Reading transcript…')
    const transcriptResult = await getTranscriptForChapters(videoId, tabId)
    if ('error' in transcriptResult) {
      return { error: transcriptResult.error }
    }

    const transcriptHash = hashTranscript(transcriptResult.text)
    if (!forceRegenerate) {
      const cached = await getCachedChaptersIfValid(videoId, transcriptHash)
      if (cached) {
        return { chapters: cached.chapters, source: cached.source, cached: true }
      }
    }

    onProgress(40, forceRegenerate ? 'Regenerating chapters…' : 'Generating chapters…')

    if (forceRegenerate) {
      if (!regenerateReason?.trim()) {
        return { error: 'A reason for regeneration is required' }
      }
      const clientId = await getOrCreateClientId()
      const result = await regenerateChapters(
        transcriptResult,
        title,
        durationSeconds,
        clientId,
        regenerateReason.trim(),
      )
      return {
        chapters: result.chapters,
        source: result.source,
        cached: false,
        stagingId: result.stagingId,
        reasonType: result.reasonType,
        needsFeedback: result.needsFeedback,
      }
    }

    const result = await generateChapters(transcriptResult, title, durationSeconds)
    return { ...result, cached: false }
  })
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

      case 'GET_CHAPTER_JOB_STATUS': {
        const { videoId } = message.payload
        const snapshot = getChapterJobSnapshot(videoId)
        sendResponse({
          snapshot,
          pending: isChapterJobRunning(videoId),
        })
        return
      }

      case 'CLEAR_CHAPTER_JOB_SNAPSHOT': {
        clearChapterJobSnapshot(message.payload.videoId)
        sendResponse({ ok: true })
        return
      }

      case 'GET_CHAPTER_CACHE': {
        const cached = await getChapterCache(message.payload.videoId)
        if (!cached) {
          sendResponse(null)
          return
        }
        sendResponse({
          chapters: cached.chapters,
          source: cached.source,
          cached: true,
          pendingFeedback: cached.pendingFeedback,
        })
        return
      }

      case 'GET_REGENERATE_QUOTA': {
        const clientId = await getOrCreateClientId()
        const videoId = message.payload?.videoId
        sendResponse(await getRegenerateQuota(clientId, videoId))
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

        if (liveContext?.needsRefresh) {
          const cached = await getChapterCache(videoId)
          if (!cached && !isChapterJobRunning(videoId)) {
            sendResponse({ error: 'Refresh the page to load this video' })
            return
          }
        }

        if (!isChapterJobRunning(videoId)) {
          const cached = await getChapterCache(videoId)
          if (cached) {
            sendResponse({
              chapters: cached.chapters,
              source: cached.source,
              cached: true,
              pendingFeedback: cached.pendingFeedback,
            })
            return
          }
        }

        const result = await executeChapterGeneration(
          videoId,
          title,
          durationSeconds,
          tabId,
          false,
        )
        sendResponse(result)
        return
      }

      case 'REGENERATE_CHAPTERS': {
        const settings = await getSettings()
        if (!settings.enabled) {
          sendResponse({ error: 'Extension is disabled in settings' })
          return
        }

        const { videoId, reason } = message.payload

        const tabId = await resolveYoutubeTabId(sender)
        if (!tabId) {
          sendResponse({ error: 'No active YouTube tab' })
          return
        }

        const liveContext = await getLiveVideoContext(tabId)
        const title = liveContext?.title ?? lastVideoContext?.payload.title ?? 'YouTube Video'
        const durationSeconds =
          liveContext?.durationSeconds ?? lastVideoContext?.payload.durationSeconds ?? 0

        const result = await executeChapterGeneration(
          videoId,
          title,
          durationSeconds,
          tabId,
          true,
          reason,
        )
        sendResponse(result)
        return
      }

      case 'SUBMIT_REGENERATE_FEEDBACK': {
        const clientId = await getOrCreateClientId()
        const { stagingId, videoId, satisfied } = message.payload
        const result = await submitRegenerateFeedback({
          clientId,
          stagingId,
          videoId,
          satisfied,
        })
        if (!('error' in result)) {
          await markChapterCacheFeedbackSubmitted(videoId)
        }
        sendResponse(result)
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
        sendResponse({ error: `Unhandled message type: ${(message as Message).type}` })
    }
  } catch (error) {
    sendResponse({ error: error instanceof Error ? error.message : 'Unknown error' })
  }
}

export {}
