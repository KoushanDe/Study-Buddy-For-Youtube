import { fetchTranscriptFromServer } from './server-transcript.client'
import { getTranscriptCache, setTranscriptCache } from '../../shared/storage/storage'
import type { TranscriptResult } from '../../shared/types/transcript'

// Chapter generation always requires the local server (for Gemini), and that
// server fetches captions reliably via a Proof-of-Origin token — with its own
// player-response fallback. So the transcript always comes from the server; we
// just keep a per-video cache to avoid refetching on regenerate.
export async function fetchTranscript(videoId: string): Promise<TranscriptResult> {
  const cached = await getTranscriptCache(videoId)
  if (cached) {
    return {
      videoId,
      language: cached.language,
      segments: cached.segments,
      text: cached.segments.map((segment) => segment.text).join(' '),
    }
  }

  const result = await fetchTranscriptFromServer(videoId)
  if (!result.segments.length) {
    throw new Error('No transcript available for this video')
  }

  await setTranscriptCache(videoId, { segments: result.segments, language: result.language })
  return result
}
