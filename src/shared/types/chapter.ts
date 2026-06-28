export interface Chapter {
  title: string
  startSeconds: number
}

export type ChapterSource = 'youtube' | 'ai'

export interface ChapterCacheEntry {
  chapters: Chapter[]
  transcriptHash?: string
  source: ChapterSource
  fetchedAt: number
  pendingFeedback?: {
    stagingId: string
    feedbackSubmitted: boolean
  }
}

export interface ChapterPromptInput {
  videoId: string
  title: string
  durationSeconds: number
  clientId?: string
  chunks: Array<{
    startSeconds: number
    endSeconds: number
    text: string
  }>
}
