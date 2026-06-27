import type { ChapterPromptInput } from '../../shared/types/chapter'
import type { Chapter } from '../../shared/types/chapter'
import { API_BASE_URL, EXTENSION_API_TOKEN } from '../../config'

const CHAPTER_API_TIMEOUT_MS = 300_000

export async function requestChaptersFromBackend(input: ChapterPromptInput): Promise<Chapter[]> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (EXTENSION_API_TOKEN) {
    headers.Authorization = `Bearer ${EXTENSION_API_TOKEN}`
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/chapters`, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(CHAPTER_API_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('Chapter generation timed out. Try again.')
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
