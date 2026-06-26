export interface ChapterGuidance {
  minChapters: number
  maxChapters: number
  minChapterGapSeconds: number
  idealChapterLengthSeconds: number
  durationLabel: string
}

export function getChapterGuidance(durationSeconds: number, chunkCount: number): ChapterGuidance {
  const minutes = Math.max(1, durationSeconds / 60)

  // Scale chapter budget with runtime; chunk count hints at how much transcript we have
  const densityFactor = chunkCount > 0 ? Math.min(1.3, chunkCount / Math.max(1, minutes / 2.5)) : 1

  if (minutes <= 5) {
    return scaleGuidance(
      { minChapters: 2, maxChapters: 5, minChapterGapSeconds: 25, idealChapterLengthSeconds: 75, durationLabel: 'short' },
      densityFactor,
    )
  }

  if (minutes <= 20) {
    return scaleGuidance(
      { minChapters: 3, maxChapters: 10, minChapterGapSeconds: 40, idealChapterLengthSeconds: 120, durationLabel: 'medium' },
      densityFactor,
    )
  }

  if (minutes <= 60) {
    return scaleGuidance(
      { minChapters: 4, maxChapters: 18, minChapterGapSeconds: 55, idealChapterLengthSeconds: 180, durationLabel: 'long' },
      densityFactor,
    )
  }

  if (minutes <= 180) {
    return scaleGuidance(
      { minChapters: 6, maxChapters: 30, minChapterGapSeconds: 75, idealChapterLengthSeconds: 240, durationLabel: 'very long' },
      densityFactor,
    )
  }

  return scaleGuidance(
    { minChapters: 10, maxChapters: 45, minChapterGapSeconds: 90, idealChapterLengthSeconds: 300, durationLabel: 'extended' },
    densityFactor,
  )
}

function scaleGuidance(base: ChapterGuidance, densityFactor: number): ChapterGuidance {
  const maxChapters = Math.min(50, Math.round(base.maxChapters * densityFactor))
  return {
    ...base,
    maxChapters: Math.max(base.minChapters + 1, maxChapters),
  }
}

export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  return `${minutes}:${String(secs).padStart(2, '0')}`
}
