import type { TranscriptSegment } from '../types/transcript'

export function parseJson3Captions(raw: string): TranscriptSegment[] {
  const data = JSON.parse(raw) as {
    events?: Array<{
      tStartMs?: number
      dDurationMs?: number
      segs?: Array<{ utf8?: string }>
    }>
  }

  const segments: TranscriptSegment[] = []
  for (const event of data.events ?? []) {
    const text = (event.segs ?? [])
      .map((seg) => seg.utf8 ?? '')
      .join('')
      .trim()
    if (!text) continue
    segments.push({
      text,
      startMs: event.tStartMs ?? 0,
      durationMs: event.dDurationMs ?? 0,
    })
  }

  return segments
}
