export interface Chapter {
  title: string
  startSeconds: number
}

export interface ChapterRequest {
  videoId: string
  title: string
  durationSeconds: number
  clientId?: string
  chunks: Array<{
    startSeconds: number
    endSeconds: number
    text: string
  }>
  regenerateContext?: {
    reasonType: 'nuanced'
    userReason: string
  }
}

export interface RegenerateRequest extends ChapterRequest {
  clientId: string
  reason: string
}

export interface RegenerateFeedbackRequest {
  clientId: string
  stagingId: string
  videoId?: string
  satisfied: boolean
}

export type ReasonValidationResult =
  | { outcome: 'approved'; reasonType: 'issue' | 'nuanced' }
  | { outcome: 'invalid' | 'dangerous' }
