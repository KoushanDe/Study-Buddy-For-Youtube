import { getActiveCooldown } from './db/cooldown.js'
import {
  getQuotaSnapshot,
  consumeRejectedQuota,
  reserveSuccessfulQuota,
  releaseSuccessfulQuota,
  hasQuotaForRejection,
  getNextQuotaResetAt,
} from './db/quota.js'
import { insertStaging, discardStaging, discardPendingStagingForVideo } from './db/staging.js'
import { getPool } from './db/pool.js'
import { generateChaptersWithGemini } from './gemini.js'
import { validateRegenerateReason } from './reason-validator.js'
import { getRegenerateConfig } from './config.js'
import type {
  Chapter,
  RegenerateFeedbackRequest,
  RegenerateRequest,
} from './types.js'

export interface RegenerateSuccess {
  chapters: Chapter[]
  stagingId: string
  reasonType: 'issue' | 'nuanced'
}

export interface RegenerateDenied {
  error: string
  denied: true
}

export interface RegenerateQuotaError {
  error: string
  quotaExhausted: true
  resetsAt: string
}

function quotaExceeded(): RegenerateQuotaError {
  return {
    error: 'Daily regenerate limit reached.',
    quotaExhausted: true,
    resetsAt: getNextQuotaResetAt().toISOString(),
  }
}

export interface RegenerateCooldownError {
  error: string
  cooldown: { videoId: string; expiresAt: string }
}

async function rejectWithQuotaConsumption(
  clientId: string,
  error: string,
): Promise<RegenerateDenied | RegenerateQuotaError> {
  const consumed = await consumeRejectedQuota(clientId)
  if (!consumed) {
    return quotaExceeded()
  }
  return { error, denied: true }
}

export async function handleRegenerate(
  body: RegenerateRequest,
): Promise<
  | RegenerateSuccess
  | RegenerateDenied
  | RegenerateQuotaError
  | RegenerateCooldownError
  | { error: string }
> {
  const reason = body.reason?.trim() ?? ''

  if (!body.clientId) {
    return { error: 'clientId is required' }
  }

  const cooldown = await getActiveCooldown(body.clientId, body.videoId)
  if (cooldown) {
    return {
      error: 'Regenerate is on cooldown for this video. Try again later.',
      cooldown,
    }
  }

  const quota = await getQuotaSnapshot(body.clientId)

  if (!reason || reason.length > 100) {
    if (!hasQuotaForRejection(quota)) {
      return quotaExceeded()
    }
    const message = !reason
      ? 'A reason for regeneration is required'
      : 'Reason must be 100 characters or fewer'
    return rejectWithQuotaConsumption(body.clientId, message)
  }

  if (!hasQuotaForRejection(quota)) {
    return quotaExceeded()
  }

  const validation = await validateRegenerateReason(reason)

  if (validation.outcome === 'invalid' || validation.outcome === 'dangerous') {
    const message =
      validation.outcome === 'dangerous'
        ? 'Regenerate request denied. Please provide a genuine reason related to chapter quality.'
        : 'Regenerate request denied. Please describe a specific issue or reasonable preference for chapter generation.'
    return rejectWithQuotaConsumption(body.clientId, message)
  }

  if (validation.outcome !== 'approved') {
    return rejectWithQuotaConsumption(body.clientId, 'Regenerate request denied.')
  }

  const reasonType = validation.reasonType

  const reserved = await reserveSuccessfulQuota(body.clientId)
  if (!reserved) {
    return quotaExceeded()
  }

  const chapterInput = {
    ...body,
    regenerateContext:
      reasonType === 'nuanced'
        ? { reasonType: 'nuanced' as const, userReason: reason }
        : undefined,
  }

  try {
    const chapters = await generateChaptersWithGemini(chapterInput)

    const stagingId = await insertStaging(
      body.clientId,
      body.videoId,
      chapters,
      reasonType,
      reason,
      body.title,
      body.durationSeconds,
    )

    return { chapters, stagingId, reasonType }
  } catch (error) {
    await releaseSuccessfulQuota(body.clientId)
    throw error
  }
}

export interface FeedbackSuccess {
  message: string
  cooldown?: { videoId: string; expiresAt: string }
}

export async function handleRegenerateFeedback(
  body: RegenerateFeedbackRequest,
): Promise<FeedbackSuccess | { error: string }> {
  if (!body.clientId || !body.stagingId) {
    return { error: 'clientId and stagingId are required' }
  }

  if (!body.satisfied) {
    let discarded = await discardStaging(body.stagingId, body.clientId)
    if (!discarded && body.videoId) {
      discarded = await discardPendingStagingForVideo(body.clientId, body.videoId)
    }
    return {
      message: discarded
        ? 'Thanks for the feedback. You can regenerate again if you have quota remaining.'
        : 'Thanks for the feedback.',
    }
  }

  const client = await getPool().connect()
  try {
    await client.query('BEGIN')

    let locked = await client.query<{
      id: string
      client_id: string
      video_id: string
      chapters: Chapter[]
      title: string | null
      duration_seconds: number | null
      reason_type: 'issue' | 'nuanced'
      reason_text: string
    }>(
      `SELECT id, client_id, video_id, chapters, title, duration_seconds, reason_type, reason_text
       FROM regeneration_staging
       WHERE id = $1 AND client_id = $2 AND status = 'pending'
       FOR UPDATE`,
      [body.stagingId, body.clientId],
    )

    if ((locked.rowCount ?? 0) === 0 && body.videoId) {
      locked = await client.query(
        `SELECT id, client_id, video_id, chapters, title, duration_seconds, reason_type, reason_text
         FROM regeneration_staging
         WHERE client_id = $1 AND video_id = $2 AND status = 'pending'
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [body.clientId, body.videoId],
      )
    }

    const row = locked.rows[0]
    if (!row) {
      await client.query('ROLLBACK')
      return { message: 'Thanks for your feedback!' }
    }

    if (row.reason_type === 'issue') {
      await client.query(
        `INSERT INTO video_chapters (video_id, chapters, title, duration_seconds, status)
         VALUES ($1, $2::jsonb, $3, $4, 'ready')
         ON CONFLICT (video_id) DO UPDATE SET
           chapters = EXCLUDED.chapters,
           title = EXCLUDED.title,
           duration_seconds = EXCLUDED.duration_seconds,
           status = 'ready',
           updated_at = now()`,
        [row.video_id, JSON.stringify(row.chapters), row.title ?? '', row.duration_seconds ?? 0],
      )
    } else {
      await client.query(
        `INSERT INTO user_video_chapters
           (client_id, video_id, chapters, reason_text, title, duration_seconds)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6)
         ON CONFLICT (client_id, video_id) DO UPDATE SET
           chapters = EXCLUDED.chapters,
           reason_text = EXCLUDED.reason_text,
           title = EXCLUDED.title,
           duration_seconds = EXCLUDED.duration_seconds,
           updated_at = now()`,
        [
          body.clientId,
          row.video_id,
          JSON.stringify(row.chapters),
          row.reason_text,
          row.title ?? '',
          row.duration_seconds ?? 0,
        ],
      )
    }

    const promoted = await client.query(
      `UPDATE regeneration_staging SET status = 'promoted'
       WHERE id = $1 AND status = 'pending'
       RETURNING id`,
      [row.id],
    )
    if ((promoted.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK')
      return { message: 'Thanks for your feedback!' }
    }

    const hours = getRegenerateConfig().cooldownHours
    const cooldownResult = await client.query<{ expires_at: Date }>(
      `INSERT INTO user_video_cooldown (client_id, video_id, expires_at)
       VALUES ($1, $2, now() + ($3 || ' hours')::interval)
       ON CONFLICT (client_id, video_id) DO UPDATE SET
         expires_at = EXCLUDED.expires_at
       RETURNING expires_at`,
      [body.clientId, row.video_id, String(hours)],
    )

    await client.query('COMMIT')

    const expiresAt = cooldownResult.rows[0]?.expires_at
    return {
      message: 'Thanks for your feedback!',
      cooldown: expiresAt
        ? { videoId: row.video_id, expiresAt: expiresAt.toISOString() }
        : undefined,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function getRegenerateQuotaForClient(
  clientId: string,
  videoId?: string,
): Promise<{
  successful: { used: number; limit: number; remaining: number }
  denied: { used: number; limit: number; remaining: number }
  resetsAt: string
  cooldown?: { videoId: string; expiresAt: string }
  onCooldown: boolean
}> {
  const quota = await getQuotaSnapshot(clientId)
  const cooldown = videoId ? await getActiveCooldown(clientId, videoId) : null
  return {
    ...quota,
    resetsAt: getNextQuotaResetAt().toISOString(),
    cooldown: cooldown ?? undefined,
    onCooldown: Boolean(cooldown),
  }
}
