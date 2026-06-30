import { CHAPTER_API_TIMEOUT_MS } from './chapter-api.client'

export interface ChapterProgressPlan {
  trickleCap: number
  trickleIntervalMs: number
  /** Target time (ms) for 5% → 39% (share of total end-to-end budget) */
  earlyPhaseBudgetMs: number
  /** Target time (ms) for 40% → 95% (share of total end-to-end budget) */
  aiPhaseBudgetMs: number
}

/**
 * Measured end-to-end times: click AI chapters → result returned.
 * Same curve for all videos; very long videos cap at CHAPTER_API_TIMEOUT_MS.
 */
const CHAPTER_API_SAMPLES = [
  { videoMinutes: 5, apiSeconds: 25 },
  { videoMinutes: 30, apiSeconds: 60 },
  { videoMinutes: 80, apiSeconds: 75 },
  { videoMinutes: 240, apiSeconds: 210 },
] as const

const TRICKLE_CAP = 95
const TRICKLE_INTERVAL_MS = 700
const EARLY_PROGRESS_SPAN = 39 - 5
const AI_PROGRESS_SPAN = TRICKLE_CAP - 40
/** Share of measured end-to-end API time budgeted for the 40% → 95% loader phase */
const AI_PHASE_TIME_SHARE = 0.98

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Piecewise-linear on measured samples; capped at chapter API timeout. */
export function interpolateChapterApiSeconds(videoMinutes: number): number {
  const samples = CHAPTER_API_SAMPLES
  const minutes = Math.max(videoMinutes, 0.5)
  const timeoutSeconds = CHAPTER_API_TIMEOUT_MS / 1000

  let seconds: number

  if (minutes <= samples[0].videoMinutes) {
    seconds = samples[0].apiSeconds * (minutes / samples[0].videoMinutes)
  } else if (minutes >= samples[samples.length - 1].videoMinutes) {
    const last = samples[samples.length - 1]
    const prev = samples[samples.length - 2]
    const slope =
      (last.apiSeconds - prev.apiSeconds) / (last.videoMinutes - prev.videoMinutes)
    seconds = last.apiSeconds + slope * (minutes - last.videoMinutes)
  } else {
    seconds = samples[samples.length - 1].apiSeconds
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i]
      const b = samples[i + 1]
      if (minutes >= a.videoMinutes && minutes <= b.videoMinutes) {
        const t = (minutes - a.videoMinutes) / (b.videoMinutes - a.videoMinutes)
        seconds = a.apiSeconds + t * (b.apiSeconds - a.apiSeconds)
        break
      }
    }
  }

  return Math.min(seconds, timeoutSeconds)
}

export function buildChapterProgressPlan(durationSeconds: number): ChapterProgressPlan {
  const totalMs = Math.round(interpolateChapterApiSeconds(durationSeconds / 60) * 1000)

  return {
    trickleCap: TRICKLE_CAP,
    trickleIntervalMs: TRICKLE_INTERVAL_MS,
    earlyPhaseBudgetMs: Math.round(totalMs * (1 - AI_PHASE_TIME_SHARE)),
    aiPhaseBudgetMs: Math.round(totalMs * AI_PHASE_TIME_SHARE),
  }
}

export function nextTrickleProgress(
  current: number,
  plan: ChapterProgressPlan,
  jobStartedAt: number | null,
  aiPhaseStartedAt: number | null,
): number {
  if (current >= plan.trickleCap) return current

  const now = Date.now()

  if (current < 40) {
    const elapsed = jobStartedAt ? now - jobStartedAt : 0
    const ratio = clamp(elapsed / plan.earlyPhaseBudgetMs, 0, 1)
    const target = 5 + ratio * EARLY_PROGRESS_SPAN
    return Math.min(39, Math.max(current, target))
  }

  const elapsed = aiPhaseStartedAt ? now - aiPhaseStartedAt : 0
  const ratio = clamp(elapsed / plan.aiPhaseBudgetMs, 0, 1)
  const target = 40 + ratio * AI_PROGRESS_SPAN
  return Math.min(plan.trickleCap, Math.max(current, target))
}
