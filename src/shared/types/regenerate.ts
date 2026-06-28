export interface QuotaBucket {
  used: number
  limit: number
  remaining: number
}

export interface RegenerateQuota {
  successful: QuotaBucket
  denied: QuotaBucket
  resetsAt: string
  cooldown?: { videoId: string; expiresAt: string }
  onCooldown: boolean
}

export interface RegenerateResult {
  chapters: import('./chapter').Chapter[]
  stagingId: string
  reasonType: 'issue' | 'nuanced'
  source: 'regenerated'
}

export interface RegenerateFeedbackResult {
  message: string
  cooldown?: { videoId: string; expiresAt: string }
}
