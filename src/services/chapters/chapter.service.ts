import { buildTranscriptChunks } from './chapter-segmenter'
import { requestChaptersFromBackend, requestRegenerateFromBackend } from './chapter-api.client'
import {
  getChapterCache,
  hashTranscript,
  setChapterCache,
} from '../../shared/storage/storage'
import { getOrCreateClientId } from '../../shared/storage/client-id'
import type { Chapter, ChapterSource } from '../../shared/types/chapter'
import type { TranscriptResult } from '../../shared/types/transcript'

export async function generateChapters(
  transcript: TranscriptResult,
  title: string,
  durationSeconds: number,
): Promise<{ chapters: Chapter[]; source: ChapterSource }> {
  const transcriptHash = hashTranscript(transcript.text)
  const source: ChapterSource = 'ai'

  const chunks = buildTranscriptChunks(transcript.segments, durationSeconds)
  const clientId = await getOrCreateClientId()
  const chapters = await requestChaptersFromBackend({
    videoId: transcript.videoId,
    title,
    durationSeconds,
    clientId,
    chunks,
  })

  await setChapterCache(transcript.videoId, {
    chapters,
    transcriptHash,
    source,
  })

  return { chapters, source }
}

export async function regenerateChapters(
  transcript: TranscriptResult,
  title: string,
  durationSeconds: number,
  clientId: string,
  reason: string,
): Promise<{
  chapters: Chapter[]
  source: ChapterSource
  stagingId: string
  reasonType: 'issue' | 'nuanced'
  needsFeedback: boolean
}> {
  const chunks = buildTranscriptChunks(transcript.segments, durationSeconds)
  const result = await requestRegenerateFromBackend({
    videoId: transcript.videoId,
    title,
    durationSeconds,
    chunks,
    clientId,
    reason,
  })

  await setChapterCache(transcript.videoId, {
    chapters: result.chapters,
    transcriptHash: hashTranscript(transcript.text),
    source: 'ai',
    pendingFeedback: {
      stagingId: result.stagingId,
      feedbackSubmitted: false,
    },
  })

  return {
    chapters: result.chapters,
    source: 'ai',
    stagingId: result.stagingId,
    reasonType: result.reasonType,
    needsFeedback: true,
  }
}

export async function cacheNativeChapters(
  videoId: string,
  chapters: Chapter[],
): Promise<{ chapters: Chapter[]; source: ChapterSource }> {
  const source: ChapterSource = 'youtube'
  await setChapterCache(videoId, {
    chapters,
    source,
  })
  return { chapters, source }
}

export async function getCachedChaptersIfValid(
  videoId: string,
  transcriptHash: string,
): Promise<{ chapters: Chapter[]; source: ChapterSource } | null> {
  const cached = await getChapterCache(videoId, transcriptHash)
  if (!cached) return null
  return { chapters: cached.chapters, source: cached.source }
}
