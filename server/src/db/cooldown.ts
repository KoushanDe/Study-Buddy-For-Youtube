import { getPool } from './pool.js'

export interface CooldownInfo {
  videoId: string
  expiresAt: string
}

export async function getActiveCooldown(
  clientId: string,
  videoId: string,
): Promise<CooldownInfo | null> {
  const result = await getPool().query<{ video_id: string; expires_at: Date }>(
    `SELECT video_id, expires_at FROM user_video_cooldown
     WHERE client_id = $1 AND video_id = $2 AND expires_at > now()`,
    [clientId, videoId],
  )
  const row = result.rows[0]
  if (!row) return null
  return { videoId: row.video_id, expiresAt: row.expires_at.toISOString() }
}
