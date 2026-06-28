import type { Chapter } from '../types.js'
import { getPool } from './pool.js'

export type VideoChapterStatus = 'generating' | 'ready' | 'api_failed'

const POLL_MS = 2_000

function waitMs(): number {
  return Number(process.env.CHAPTER_GENERATION_WAIT_MS ?? 300_000)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function getReadyVideoChapters(videoId: string): Promise<Chapter[] | null> {
  const result = await getPool().query<{ chapters: Chapter[] | null }>(
    `SELECT chapters FROM video_chapters
     WHERE video_id = $1 AND status = 'ready' AND chapters IS NOT NULL`,
    [videoId],
  )
  const chapters = result.rows[0]?.chapters
  return chapters?.length ? chapters : null
}

async function tryInsertGenerating(
  videoId: string,
  title: string,
  durationSeconds: number,
): Promise<boolean> {
  const result = await getPool().query(
    `INSERT INTO video_chapters (video_id, title, duration_seconds, status, chapters)
     VALUES ($1, $2, $3, 'generating', NULL)
     ON CONFLICT (video_id) DO NOTHING
     RETURNING video_id`,
    [videoId, title, durationSeconds],
  )
  return (result.rowCount ?? 0) > 0
}

async function tryClaimApiFailed(
  videoId: string,
  title: string,
  durationSeconds: number,
): Promise<boolean> {
  const result = await getPool().query(
    `UPDATE video_chapters
     SET status = 'generating', title = $2, duration_seconds = $3, updated_at = now()
     WHERE video_id = $1 AND status = 'api_failed'
     RETURNING video_id`,
    [videoId, title, durationSeconds],
  )
  return (result.rowCount ?? 0) > 0
}

async function getVideoChapterStatus(videoId: string): Promise<VideoChapterStatus | null> {
  const result = await getPool().query<{ status: VideoChapterStatus }>(
    'SELECT status FROM video_chapters WHERE video_id = $1',
    [videoId],
  )
  return result.rows[0]?.status ?? null
}

async function markReady(
  videoId: string,
  chapters: Chapter[],
  title: string,
  durationSeconds: number,
): Promise<void> {
  await getPool().query(
    `UPDATE video_chapters
     SET chapters = $2::jsonb, title = $3, duration_seconds = $4, status = 'ready', updated_at = now()
     WHERE video_id = $1`,
    [videoId, JSON.stringify(chapters), title, durationSeconds],
  )
}

async function markApiFailed(videoId: string): Promise<void> {
  await getPool().query(
    `UPDATE video_chapters SET status = 'api_failed', updated_at = now() WHERE video_id = $1`,
    [videoId],
  )
}

export async function generateWithGlobalLock(
  videoId: string,
  title: string,
  durationSeconds: number,
  generate: () => Promise<Chapter[]>,
): Promise<Chapter[]> {
  const deadline = Date.now() + waitMs()

  while (Date.now() < deadline) {
    const ready = await getReadyVideoChapters(videoId)
    if (ready) return ready

    const status = await getVideoChapterStatus(videoId)

    if (status === null) {
      if (await tryInsertGenerating(videoId, title, durationSeconds)) {
        try {
          const chapters = await generate()
          await markReady(videoId, chapters, title, durationSeconds)
          return chapters
        } catch (error) {
          await markApiFailed(videoId)
          throw error
        }
      }
      await sleep(POLL_MS)
      continue
    }

    if (status === 'api_failed') {
      if (await tryClaimApiFailed(videoId, title, durationSeconds)) {
        try {
          const chapters = await generate()
          await markReady(videoId, chapters, title, durationSeconds)
          return chapters
        } catch (error) {
          await markApiFailed(videoId)
          throw error
        }
      }
      await sleep(POLL_MS)
      continue
    }

    if (status === 'generating') {
      await sleep(POLL_MS)
      continue
    }

    if (status === 'ready') {
      const chapters = await getReadyVideoChapters(videoId)
      if (chapters) return chapters
    }

    await sleep(POLL_MS)
  }

  throw new Error('Chapter generation timed out waiting for another request to finish')
}
