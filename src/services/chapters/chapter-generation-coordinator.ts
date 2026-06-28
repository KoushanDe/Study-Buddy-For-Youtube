import type { Chapter, ChapterSource } from '../../shared/types/chapter'

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

function stopTrickle(): void {
  if (trickleTimer !== null) {
    clearInterval(trickleTimer)
    trickleTimer = null
  }
}

function trickleStep(current: number): number {
  if (current >= 95) return current
  const step = current < 30 ? 2.5 : current < 60 ? 1.2 : current < 85 ? 0.5 : 0.2
  return Math.min(95, current + step)
}

function startTrickle(videoId: string, emitProgress: ProgressEmitter): void {
  stopTrickle()
  trickleTimer = setInterval(() => {
    if (snapshot.status !== 'running' || snapshot.videoId !== videoId) {
      stopTrickle()
      return
    }

    const next = trickleStep(snapshot.progress)
    if (next === snapshot.progress) return

    snapshot = { ...snapshot, progress: next }
    emitProgress(videoId, next, snapshot.label)
  }, 350)
}

export function getChapterJobSnapshot(videoId: string): ChapterJobSnapshot | null {
  if (snapshot.status === 'idle' || snapshot.videoId !== videoId) return null

  // Job promise finished but snapshot was not advanced — don't trap the UI in a loader.
  if (snapshot.status === 'running' && !inFlight.has(videoId)) {
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
  emitProgress: ProgressEmitter,
  runner: ChapterRunner,
): Promise<ChapterGenerationResult> {
  const existing = inFlight.get(videoId)
  if (existing) {
    if (snapshot.videoId === videoId && snapshot.status === 'running') {
      emitProgress(videoId, snapshot.progress, snapshot.label)
      if (trickleTimer === null) {
        startTrickle(videoId, emitProgress)
      }
    }
    return existing
  }

  let resolveJob!: (result: ChapterGenerationResult) => void
  const promise = new Promise<ChapterGenerationResult>((resolve) => {
    resolveJob = resolve
  })
  inFlight.set(videoId, promise)

  snapshot = {
    videoId,
    progress: 5,
    label: 'Starting…',
    status: 'running',
  }
  emitProgress(videoId, snapshot.progress, snapshot.label)
  startTrickle(videoId, emitProgress)

  void (async () => {
    const onProgress = (progress: number, label: string) => {
      snapshot = {
        videoId,
        progress: Math.max(snapshot.progress, progress),
        label,
        status: 'running',
      }
      emitProgress(videoId, snapshot.progress, label)
    }

    try {
      const result = await runner(onProgress)
      stopTrickle()
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
