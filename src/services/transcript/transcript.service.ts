import { sendMessageToTab } from '../../shared/messaging/send-message'
import { getTranscriptCache, setTranscriptCache } from '../../shared/storage/storage'
import type { TranscriptResult } from '../../shared/types/transcript'

export async function fetchTranscript(videoId: string, tabId: number): Promise<TranscriptResult> {
  const cached = await getTranscriptCache(videoId)
  if (cached) {
    return {
      videoId,
      language: cached.language,
      segments: cached.segments,
      text: cached.segments.map((segment) => segment.text).join(' '),
    }
  }

  const response = (await sendMessageToTab(tabId, {
    type: 'FETCH_TRANSCRIPT',
    payload: { videoId },
  })) as { result?: TranscriptResult; error?: string } | undefined

  if (response?.error) {
    throw new Error(response.error)
  }

  const result = response?.result
  if (!result?.segments?.length) {
    throw new Error('No transcript available for this video')
  }

  await setTranscriptCache(videoId, { segments: result.segments, language: result.language })
  return result
}
