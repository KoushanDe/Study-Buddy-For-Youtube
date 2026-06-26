export interface TranscriptSegment {
  text: string
  startMs: number
  durationMs: number
}

export interface TranscriptResult {
  videoId: string
  language: string
  segments: TranscriptSegment[]
  text: string
}

export interface TranscriptCacheEntry {
  segments: TranscriptSegment[]
  language: string
  fetchedAt: number
}
