const REGENERATE_LOG_KEY = 'regenerateLog'
const REGENERATE_WINDOW_MS = 60_000
const REGENERATE_MAX_PER_WINDOW = 2

// Per-user (browser profile) regenerate quota — not shared across users or enforced server-side.

async function readLog(): Promise<number[]> {
  try {
    const result = await chrome.storage.local.get(REGENERATE_LOG_KEY)
    const log = result[REGENERATE_LOG_KEY]
    return Array.isArray(log) ? (log as number[]) : []
  } catch {
    return []
  }
}

async function writeLog(timestamps: number[]): Promise<void> {
  try {
    await chrome.storage.local.set({ [REGENERATE_LOG_KEY]: timestamps })
  } catch {
    // ignore
  }
}

export interface RegenerateQuota {
  allowed: boolean
  remaining: number
  retryAfterMs: number
}

export async function getRegenerateQuota(): Promise<RegenerateQuota> {
  const now = Date.now()
  const recent = (await readLog()).filter((timestamp) => now - timestamp < REGENERATE_WINDOW_MS)
  await writeLog(recent)

  const remaining = Math.max(0, REGENERATE_MAX_PER_WINDOW - recent.length)
  const oldest = recent[0]
  const retryAfterMs =
    remaining === 0 && oldest != null ? Math.max(0, REGENERATE_WINDOW_MS - (now - oldest)) : 0

  return {
    allowed: remaining > 0,
    remaining,
    retryAfterMs,
  }
}

export async function recordRegenerate(): Promise<void> {
  const now = Date.now()
  const recent = (await readLog()).filter((timestamp) => now - timestamp < REGENERATE_WINDOW_MS)
  recent.push(now)
  await writeLog(recent)
}
