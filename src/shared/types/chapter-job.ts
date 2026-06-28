import type { Chapter, ChapterSource } from './chapter'

export interface ChapterJobStatusResponse {
  snapshot?: {
    status: 'running' | 'done' | 'error'
    progress: number
    label: string
    result?: {
      error?: string
      chapters?: Chapter[]
      source?: ChapterSource
      cached?: boolean
      stagingId?: string
      needsFeedback?: boolean
      pendingFeedback?: { stagingId: string; feedbackSubmitted: boolean }
    }
  } | null
  pending?: boolean
}
