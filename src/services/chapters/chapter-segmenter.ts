import type { TranscriptSegment } from '../../shared/types/transcript'
import type { ChapterPromptInput } from '../../shared/types/chapter'

// Granularity of the inline `@<seconds>` markers embedded in each chunk. The
// model uses these to pin a chapter to the moment a topic actually starts, so
// this is effectively the timestamp resolution of generated chapters.
const MARKER_WINDOW_SECONDS = 10

function getChunkWindowSeconds(durationSeconds: number): number {
  const minutes = durationSeconds / 60

  if (minutes <= 15) return 90
  if (minutes <= 45) return 120
  if (minutes <= 120) return 150
  return 180
}

export function buildTranscriptChunks(
  segments: TranscriptSegment[],
  durationSeconds: number,
): ChapterPromptInput['chunks'] {
  if (!segments.length) return []

  const chunkWindow = getChunkWindowSeconds(durationSeconds)
  const chunks: ChapterPromptInput['chunks'] = []
  let currentStart = 0
  let currentSegments: TranscriptSegment[] = []

  for (const segment of segments) {
    const startSeconds = Math.floor(segment.startMs / 1000)

    if (startSeconds - currentStart >= chunkWindow && currentSegments.length) {
      chunks.push({
        startSeconds: currentStart,
        endSeconds: startSeconds,
        text: formatTimestampedText(currentSegments),
      })
      currentStart = startSeconds
      currentSegments = []
    }

    currentSegments.push(segment)
  }

  if (currentSegments.length) {
    chunks.push({
      startSeconds: currentStart,
      endSeconds: durationSeconds || Math.floor((segments.at(-1)?.startMs ?? 0) / 1000) + 30,
      text: formatTimestampedText(currentSegments),
    })
  }

  return chunks.filter((chunk) => chunk.text.length > 0)
}

// Groups a chunk's segments into ~MARKER_WINDOW_SECONDS lines, each prefixed
// with `@<seconds>` so the model can copy a precise start time into a chapter.
function formatTimestampedText(segments: TranscriptSegment[]): string {
  const lines: string[] = []
  let blockStart = -Infinity
  let buffer: string[] = []

  const flush = () => {
    if (!buffer.length) return
    lines.push(`@${Math.floor(blockStart)} ${buffer.join(' ').trim()}`)
    buffer = []
  }

  for (const segment of segments) {
    const startSeconds = Math.floor(segment.startMs / 1000)
    if (startSeconds - blockStart >= MARKER_WINDOW_SECONDS) {
      flush()
      blockStart = startSeconds
    }
    buffer.push(segment.text)
  }

  flush()
  return lines.join('\n').trim()
}
