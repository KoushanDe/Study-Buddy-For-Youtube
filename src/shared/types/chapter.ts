export interface Chapter {
  title: string
  startSeconds: number
}

export type ChapterSource = 'youtube' | 'ai'

export interface ChaptersResponse {
  chapters: Chapter[]
  source: ChapterSource
  cached?: boolean
  error?: string
}

export interface ChapterCacheEntry {
  chapters: Chapter[]
  transcriptHash?: string
  source: ChapterSource
  fetchedAt: number
}

export interface ChapterPromptInput {
  videoId: string
  title: string
  durationSeconds: number
  chunks: Array<{
    startSeconds: number
    endSeconds: number
    text: string
  }>
}
