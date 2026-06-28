import { getPool } from './pool.js'
import { getRegenerateConfig } from '../config.js'

function utcDateString(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Next UTC midnight when daily regenerate quotas reset. */
export function getNextQuotaResetAt(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
}

export interface QuotaSnapshot {
  successful: { used: number; limit: number; remaining: number }
  denied: { used: number; limit: number; remaining: number }
}

async function ensureQuotaRow(clientId: string, date: string): Promise<void> {
  await getPool().query(
    `INSERT INTO regenerate_quota (client_id, quota_date, successful_count, denied_count)
     VALUES ($1, $2, 0, 0)
     ON CONFLICT (client_id, quota_date) DO NOTHING`,
    [clientId, date],
  )
}

async function getCounts(clientId: string): Promise<{ successful: number; denied: number }> {
  const date = utcDateString()
  await ensureQuotaRow(clientId, date)
  const result = await getPool().query<{ successful_count: number; denied_count: number }>(
    `SELECT successful_count, denied_count FROM regenerate_quota
     WHERE client_id = $1 AND quota_date = $2`,
    [clientId, date],
  )
  const row = result.rows[0]
  return {
    successful: row?.successful_count ?? 0,
    denied: row?.denied_count ?? 0,
  }
}

export async function getQuotaSnapshot(clientId: string): Promise<QuotaSnapshot> {
  const config = getRegenerateConfig()
  const counts = await getCounts(clientId)
  return {
    successful: {
      used: counts.successful,
      limit: config.successDailyLimit,
      remaining: Math.max(0, config.successDailyLimit - counts.successful),
    },
    denied: {
      used: counts.denied,
      limit: config.deniedDailyLimit,
      remaining: Math.max(0, config.deniedDailyLimit - counts.denied),
    },
  }
}

/** Rejected validation: denied bucket first, then successful bucket if denied is exhausted. */
export async function consumeRejectedQuota(clientId: string): Promise<boolean> {
  const config = getRegenerateConfig()
  const date = utcDateString()
  await ensureQuotaRow(clientId, date)

  const denied = await getPool().query(
    `UPDATE regenerate_quota
     SET denied_count = denied_count + 1
     WHERE client_id = $1 AND quota_date = $2 AND denied_count < $3
     RETURNING client_id`,
    [clientId, date, config.deniedDailyLimit],
  )
  if ((denied.rowCount ?? 0) > 0) return true

  const success = await getPool().query(
    `UPDATE regenerate_quota
     SET successful_count = successful_count + 1
     WHERE client_id = $1 AND quota_date = $2 AND successful_count < $3
     RETURNING client_id`,
    [clientId, date, config.successDailyLimit],
  )
  return (success.rowCount ?? 0) > 0
}

/** Atomically reserve one successful regeneration slot (consumed on success). */
export async function reserveSuccessfulQuota(clientId: string): Promise<boolean> {
  const config = getRegenerateConfig()
  const date = utcDateString()
  await ensureQuotaRow(clientId, date)

  const result = await getPool().query(
    `UPDATE regenerate_quota
     SET successful_count = successful_count + 1
     WHERE client_id = $1 AND quota_date = $2 AND successful_count < $3
     RETURNING client_id`,
    [clientId, date, config.successDailyLimit],
  )
  return (result.rowCount ?? 0) > 0
}

/** Release a reserved successful slot when generation or staging fails. */
export async function releaseSuccessfulQuota(clientId: string): Promise<void> {
  const date = utcDateString()
  await getPool().query(
    `UPDATE regenerate_quota
     SET successful_count = successful_count - 1
     WHERE client_id = $1 AND quota_date = $2 AND successful_count > 0`,
    [clientId, date],
  )
}

export function hasQuotaForRejection(snapshot: QuotaSnapshot): boolean {
  return snapshot.denied.remaining > 0 || snapshot.successful.remaining > 0
}
