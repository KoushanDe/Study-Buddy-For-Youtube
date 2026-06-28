import type { ChapterPromptInput } from '../../shared/types/chapter'
import type { Chapter } from '../../shared/types/chapter'
import type {
  RegenerateFeedbackResult,
  RegenerateQuota,
  RegenerateResult,
} from '../../shared/types/regenerate'
import { API_BASE_URL, EXTENSION_API_TOKEN } from '../../config'
import { formatSuccessQuotaExceededMessage } from '../../shared/utils/quota-reset'

const CHAPTER_API_TIMEOUT_MS = 300_000

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (EXTENSION_API_TOKEN) {
    headers.Authorization = `Bearer ${EXTENSION_API_TOKEN}`
  }
  return headers
}

export async function requestChaptersFromBackend(input: ChapterPromptInput): Promise<Chapter[]> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/chapters`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(CHAPTER_API_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('Chapter generation timed out. Try again.', { cause: error })
    }
    throw error
  }

  const data = (await response.json().catch(() => ({}))) as {
    chapters?: Chapter[]
    error?: string
  }

  if (!response.ok) {
    throw new Error(data.error ?? `Chapter API failed (${response.status})`)
  }

  if (!data.chapters?.length) {
    throw new Error('Chapter API returned no chapters')
  }

  return data.chapters
}

export async function getRegenerateQuota(
  clientId: string,
  videoId?: string,
): Promise<RegenerateQuota> {
  const params = new URLSearchParams({ clientId })
  if (videoId) params.set('videoId', videoId)

  const response = await fetch(`${API_BASE_URL}/api/regenerate/quota?${params}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(30_000),
  })

  const data = (await response.json().catch(() => ({}))) as RegenerateQuota & { error?: string }

  if (!response.ok) {
    throw new Error(data.error ?? `Quota API failed (${response.status})`)
  }

  return data
}

export interface RegenerateApiInput extends ChapterPromptInput {
  clientId: string
  reason: string
}

export async function requestRegenerateFromBackend(
  input: RegenerateApiInput,
): Promise<RegenerateResult> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/regenerate`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(CHAPTER_API_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('Chapter regeneration timed out. Try again.', { cause: error })
    }
    throw error
  }

  const data = (await response.json().catch(() => ({}))) as RegenerateResult & {
    error?: string
    denied?: boolean
    quotaExhausted?: boolean
    resetsAt?: string
    cooldown?: { videoId: string; expiresAt: string }
  }

  if (!response.ok) {
    if (data.quotaExhausted) {
      throw new Error(formatSuccessQuotaExceededMessage(data.resetsAt))
    }
    throw new Error(data.error ?? `Regenerate API failed (${response.status})`)
  }

  if (!data.chapters?.length || !data.stagingId) {
    throw new Error('Regenerate API returned an incomplete response')
  }

  return data
}

export async function submitRegenerateFeedback(input: {
  clientId: string
  stagingId: string
  videoId: string
  satisfied: boolean
}): Promise<RegenerateFeedbackResult> {
  const response = await fetch(`${API_BASE_URL}/api/regenerate/feedback`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(30_000),
  })

  const data = (await response.json().catch(() => ({}))) as RegenerateFeedbackResult & {
    error?: string
  }

  if (!response.ok) {
    throw new Error(data.error ?? `Feedback API failed (${response.status})`)
  }

  return data
}
