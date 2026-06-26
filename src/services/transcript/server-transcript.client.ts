import { API_BASE_URL, EXTENSION_API_TOKEN } from '../../config'
import type { TranscriptResult } from '../../shared/types/transcript'

export async function fetchTranscriptFromServer(videoId: string): Promise<TranscriptResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (EXTENSION_API_TOKEN) {
    headers.Authorization = `Bearer ${EXTENSION_API_TOKEN}`
  }

  const response = await fetch(`${API_BASE_URL}/api/transcript`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ videoId }),
  })

  const data = (await response.json().catch(() => ({}))) as TranscriptResult & { error?: string }

  if (!response.ok) {
    throw new Error(data.error ?? `Transcript API failed (${response.status})`)
  }

  if (!data.segments?.length) {
    throw new Error('Transcript API returned no segments')
  }

  return {
    videoId: data.videoId ?? videoId,
    language: data.language ?? 'server',
    segments: data.segments,
    text: data.text ?? data.segments.map((segment) => segment.text).join(' '),
  }
}
