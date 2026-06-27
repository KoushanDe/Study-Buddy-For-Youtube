import type { Chapter } from '../types/chapter'
import { formatTimestamp } from './format-duration'

export function formatChaptersForClipboard(chapters: Chapter[]): string {
  return chapters
    .map((chapter) => `${formatTimestamp(chapter.startSeconds)} ${chapter.title}`)
    .join('\n')
}
