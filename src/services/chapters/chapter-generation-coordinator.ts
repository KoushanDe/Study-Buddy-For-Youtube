import type { Chapter, ChapterSource } from '../../shared/types/chapter'
import {
  buildChapterProgressPlan,
  nextTrickleProgress,
  type ChapterProgressPlan,
} from './chapter-progress-plan'

export interface ChapterGenerationResult {
  chapters?: Chapter[]
  source?: ChapterSource
  cached?: boolean
  error?: string
  stagingId?: string
  reasonType?: 'issue' | 'nuanced'
  needsFeedback?: boolean
}

export type ChapterJobStatus = 'idle' | 'running' | 'done' | 'error'

export interface ChapterJobSnapshot {
  videoId: string
  progress: number
  label: string
  status: ChapterJobStatus
  result?: ChapterGenerationResult
}

type ProgressEmitter = (videoId: string, progress: number, label: string) => void
type ChapterRunner = (onProgress: (progress: number, label: string) => void) => Promise<ChapterGenerationResult>

let snapshot: ChapterJobSnapshot = {
  videoId: '',
  progress: 0,
  label: '',
  status: 'idle',
}

const inFlight = new Map<string, Promise<ChapterGenerationResult>>()
let trickleTimer: ReturnType<typeof setInterval> | null = null
let activeProgressPlan: ChapterProgressPlan | null = null
let jobStartedAt: number | null = null
let aiPhaseStartedAt: number | null = null

function stopTrickle(): void {
  if (trickleTimer !== null) {
    clearInterval(trickleTimer)
    trickleTimer = null
  }
}

function resetProgressTracking(): void {
  activeProgressPlan = null
  jobStartedAt = null
  aiPhaseStartedAt = null
}

function markAiPhaseStarted(progress: number): void {
  if (progress >= 40 && aiPhaseStartedAt === null) {
    aiPhaseStartedAt = Date.now()
  }
}

function startTrickle(videoId: string, plan: ChapterProgressPlan, emitProgress: ProgressEmitter): void {
  stopTrickle()
  activeProgressPlan = plan
  trickleTimer = setInterval(() => {
    if (snapshot.status !== 'running' || snapshot.videoId !== videoId || !activeProgressPlan) {
      stopTrickle()
      return
    }

    const next = nextTrickleProgress(
      snapshot.progress,
      activeProgressPlan,
      jobStartedAt,
      aiPhaseStartedAt,
    )
    if (next === snapshot.progress) return

    snapshot = { ...snapshot, progress: next }
    emitProgress(videoId, next, snapshot.label)
  }, plan.trickleIntervalMs)
}

export function getChapterJobSnapshot(videoId: string): ChapterJobSnapshot | null {
  if (snapshot.status === 'idle' || snapshot.videoId !== videoId) return null

  if (snapshot.status === 'running' && !inFlight.has(videoId)) {
    stopTrickle()
    resetProgressTracking()
    snapshot = {
      videoId: '',
      progress: 0,
      label: '',
      status: 'idle',
    }
    return null
  }

  return { ...snapshot, result: snapshot.result ? { ...snapshot.result } : undefined }
}

export function clearChapterJobSnapshot(videoId: string): void {
  if (snapshot.videoId !== videoId) return
  stopTrickle()
  resetProgressTracking()
  snapshot = {
    videoId: '',
    progress: 0,
    label: '',
    status: 'idle',
  }
}

export function isChapterJobRunning(videoId?: string): boolean {
  if (videoId) return inFlight.has(videoId)
  return inFlight.size > 0
}

export function runDedupedChapterJob(
  videoId: string,
  durationSeconds: number,
  _forceRegenerate: boolean,
  emitProgress: ProgressEmitter,
  runner: ChapterRunner,
): Promise<ChapterGenerationResult> {
  const progressPlan = buildChapterProgressPlan(durationSeconds)

  const existing = inFlight.get(videoId)
  if (existing) {
    if (snapshot.videoId === videoId && snapshot.status === 'running') {
      emitProgress(videoId, snapshot.progress, snapshot.label)
      if (trickleTimer === null) {
        startTrickle(videoId, activeProgressPlan ?? progressPlan, emitProgress)
      }
    }
    return existing
  }

  let resolveJob!: (result: ChapterGenerationResult) => void
  const promise = new Promise<ChapterGenerationResult>((resolve) => {
    resolveJob = resolve
  })
  inFlight.set(videoId, promise)

  resetProgressTracking()
  jobStartedAt = Date.now()

  snapshot = {
    videoId,
    progress: 5,
    label: 'Starting…',
    status: 'running',
  }
  emitProgress(videoId, snapshot.progress, snapshot.label)
  startTrickle(videoId, progressPlan, emitProgress)

  void (async () => {
    const onProgress = (progress: number, label: string) => {
      markAiPhaseStarted(progress)
      snapshot = {
        videoId,
        progress: Math.max(snapshot.progress, progress),
        label,
        status: 'running',
      }
      markAiPhaseStarted(snapshot.progress)
      emitProgress(videoId, snapshot.progress, label)
    }

    try {
      const result = await runner(onProgress)
      stopTrickle()
      resetProgressTracking()
      snapshot = {
        videoId,
        progress: 100,
        label: 'Done',
        status: result.error ? 'error' : 'done',
        result,
      }
      if (!result.error) {
        emitProgress(videoId, 100, 'Done')
      }
      resolveJob(result)
    } catch (error) {
      stopTrickle()
      resetProgressTracking()
      const result: ChapterGenerationResult = {
        error: error instanceof Error ? error.message : 'Chapter generation failed',
      }
      snapshot = {
        videoId,
        progress: snapshot.progress,
        label: 'Failed',
        status: 'error',
        result,
      }
      resolveJob(result)
    } finally {
      inFlight.delete(videoId)
    }
  })()

  return promise
}
