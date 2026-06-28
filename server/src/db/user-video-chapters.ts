import type { Chapter } from '../types.js'
import { getPool } from './pool.js'

export async function getUserVideoChapters(
  clientId: string,
  videoId: string,
): Promise<Chapter[] | null> {
  const result = await getPool().query<{ chapters: Chapter[] }>(
    'SELECT chapters FROM user_video_chapters WHERE client_id = $1 AND video_id = $2',
    [clientId, videoId],
  )
  const row = result.rows[0]
  return row?.chapters ?? null
}
