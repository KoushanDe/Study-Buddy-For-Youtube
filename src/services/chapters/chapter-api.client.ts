import type { ChapterPromptInput } from '../../shared/types/chapter'
import type { Chapter } from '../../shared/types/chapter'
import { API_BASE_URL, EXTENSION_API_TOKEN } from '../../config'

export async function requestChaptersFromBackend(input: ChapterPromptInput): Promise<Chapter[]> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (EXTENSION_API_TOKEN) {
    headers.Authorization = `Bearer ${EXTENSION_API_TOKEN}`
  }

  const response = await fetch(`${API_BASE_URL}/api/chapters`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  })

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
