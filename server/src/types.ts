export interface Chapter {
  title: string
  startSeconds: number
}

export interface ChapterRequest {
  videoId: string
  title: string
  durationSeconds: number
  chunks: Array<{
    startSeconds: number
    endSeconds: number
    text: string
  }>
}
