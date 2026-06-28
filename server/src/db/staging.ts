import type { Chapter } from '../types.js'
import { getPool } from './pool.js'

export type ReasonType = 'issue' | 'nuanced'
export type StagingStatus = 'pending' | 'promoted' | 'discarded' | 'superseded'

export interface StagingRow {
  id: string
  clientId: string
  videoId: string
  chapters: Chapter[]
  title: string
  durationSeconds: number
  reasonType: ReasonType
  reasonText: string
  status: StagingStatus
}

function mapRow(row: {
  id: string
  client_id: string
  video_id: string
  chapters: Chapter[]
  title: string | null
  duration_seconds: number | null
  reason_type: ReasonType
  reason_text: string
  status: StagingStatus
}): StagingRow {
  return {
    id: row.id,
    clientId: row.client_id,
    videoId: row.video_id,
    chapters: row.chapters,
    title: row.title ?? '',
    durationSeconds: row.duration_seconds ?? 0,
    reasonType: row.reason_type,
    reasonText: row.reason_text,
    status: row.status,
  }
}

function advisoryLockKey(clientId: string, videoId: string): string {
  return `${clientId}:${videoId}`
}

export async function insertStaging(
  clientId: string,
  videoId: string,
  chapters: Chapter[],
  reasonType: ReasonType,
  reasonText: string,
  title: string,
  durationSeconds: number,
): Promise<string> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [advisoryLockKey(clientId, videoId)])

    await client.query(
      `UPDATE regeneration_staging
       SET status = 'superseded'
       WHERE client_id = $1 AND video_id = $2 AND status = 'pending'`,
      [clientId, videoId],
    )

    const result = await client.query<{ id: string }>(
      `INSERT INTO regeneration_staging
         (client_id, video_id, chapters, title, duration_seconds, reason_type, reason_text)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
       RETURNING id`,
      [clientId, videoId, JSON.stringify(chapters), title, durationSeconds, reasonType, reasonText],
    )

    const id = result.rows[0]?.id
    if (!id) throw new Error('Failed to create staging row')

    await client.query('COMMIT')
    return id
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function discardStaging(
  stagingId: string,
  clientId: string,
): Promise<StagingRow | null> {
  const result = await getPool().query<{
    id: string
    client_id: string
    video_id: string
    chapters: Chapter[]
    title: string | null
    duration_seconds: number | null
    reason_type: ReasonType
    reason_text: string
    status: StagingStatus
  }>(
    `UPDATE regeneration_staging
     SET status = 'discarded'
     WHERE id = $1 AND client_id = $2 AND status IN ('pending', 'superseded')
     RETURNING id, client_id, video_id, chapters, title, duration_seconds, reason_type, reason_text, status`,
    [stagingId, clientId],
  )
  const row = result.rows[0]
  return row ? mapRow(row) : null
}

export async function discardPendingStagingForVideo(
  clientId: string,
  videoId: string,
): Promise<StagingRow | null> {
  const result = await getPool().query<{
    id: string
    client_id: string
    video_id: string
    chapters: Chapter[]
    title: string | null
    duration_seconds: number | null
    reason_type: ReasonType
    reason_text: string
    status: StagingStatus
  }>(
    `UPDATE regeneration_staging
     SET status = 'discarded'
     WHERE client_id = $1 AND video_id = $2 AND status = 'pending'
     RETURNING id, client_id, video_id, chapters, title, duration_seconds, reason_type, reason_text, status`,
    [clientId, videoId],
  )
  const row = result.rows[0]
  return row ? mapRow(row) : null
}
