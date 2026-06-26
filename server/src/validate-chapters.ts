import type { Chapter } from './types.js'
import type { ChapterGuidance } from './chapter-guidance.js'

export function validateChapters(
  chapters: Chapter[],
  durationSeconds: number,
  guidance: ChapterGuidance,
): Chapter[] {
  const sorted = [...chapters]
    .map((chapter) => ({
      title: chapter.title.trim(),
      startSeconds: Math.max(0, Math.floor(chapter.startSeconds)),
    }))
    .filter((chapter) => chapter.title.length > 0)
    .sort((a, b) => a.startSeconds - b.startSeconds)

  const deduped: Chapter[] = []
  for (const chapter of sorted) {
    if (durationSeconds > 0 && chapter.startSeconds > durationSeconds) continue
    if (deduped.some((item) => item.startSeconds === chapter.startSeconds)) continue
    deduped.push(chapter)
  }

  const spaced = enforceMinimumGap(deduped, guidance.minChapterGapSeconds)

  if (!spaced.length) {
    return [{ title: 'Full Video', startSeconds: 0 }]
  }

  if (spaced[0].startSeconds > 30) {
    spaced.unshift({ title: 'Introduction', startSeconds: 0 })
  } else if (spaced[0].startSeconds > 0) {
    spaced[0] = { ...spaced[0], startSeconds: 0 }
  }

  return spaced.slice(0, guidance.maxChapters)
}

function enforceMinimumGap(chapters: Chapter[], minGapSeconds: number): Chapter[] {
  if (chapters.length <= 1) return chapters

  const result: Chapter[] = [chapters[0]]

  for (let i = 1; i < chapters.length; i += 1) {
    const previous = result[result.length - 1]
    const current = chapters[i]
    const gap = current.startSeconds - previous.startSeconds

    if (gap < minGapSeconds) {
      // Keep the chapter whose title looks more like a section header (longer / more specific)
      if (current.title.length > previous.title.length + 8) {
        result[result.length - 1] = current
      }
      continue
    }

    result.push(current)
  }

  return result
}
