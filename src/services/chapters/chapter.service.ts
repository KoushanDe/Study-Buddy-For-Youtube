import { buildTranscriptChunks } from './chapter-segmenter'
import { requestChaptersFromBackend } from './chapter-api.client'
import {
  getChapterCache,
  hashTranscript,
  invalidateChapterCache,
  setChapterCache,
} from '../../shared/storage/storage'
import type { Chapter, ChapterSource } from '../../shared/types/chapter'
import type { TranscriptResult } from '../../shared/types/transcript'

export async function generateChapters(
  transcript: TranscriptResult,
  title: string,
  durationSeconds: number,
  force = false,
): Promise<{ chapters: Chapter[]; source: ChapterSource }> {
  const transcriptHash = hashTranscript(transcript.text)
  const source: ChapterSource = 'ai'

  if (!force) {
    const cached = await getChapterCache(transcript.videoId, transcriptHash)
    if (cached) return { chapters: cached.chapters, source: cached.source }
  }

  const chunks = buildTranscriptChunks(transcript.segments, durationSeconds)
  const chapters = await requestChaptersFromBackend({
    videoId: transcript.videoId,
    title,
    durationSeconds,
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
): Promise<{ chapters: Chapter[]; source: ChapterSource }> {
  await invalidateChapterCache(transcript.videoId)
  return generateChapters(transcript, title, durationSeconds, true)
}

export async function cacheNativeChapters(
  videoId: string,
  chapters: Chapter[],
): Promise<{ chapters: Chapter[]; source: ChapterSource }> {
  const source: ChapterSource = 'ai'
  await setChapterCache(videoId, {
    chapters,
    source,
  })
  return { chapters, source }
}
