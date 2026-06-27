import { useCallback, useEffect, useState } from 'react'
import type { Chapter, ChapterSource } from '../../shared/types/chapter'
import type { ChapterJobStatusResponse } from '../../shared/types/chapter-job'
import type { VideoContext } from '../../shared/types/video'
import { sendMessage } from '../../shared/messaging/send-message'
import type { RegenerateQuota } from '../../shared/storage/regenerate-rate-limit'
import { formatChaptersForClipboard } from '../../shared/utils/chapter-clipboard'
import { formatTimestamp } from '../../shared/utils/format-duration'

function CopyIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

interface ChaptersPanelProps {
  videoContext: VideoContext | null
  onRefreshTab: () => void
}

function sourceLabel(source: ChapterSource): string {
  return source === 'youtube' ? 'YouTube chapters' : 'AI chapters'
}

export function ChaptersPanel({ videoContext, onRefreshTab }: ChaptersPanelProps) {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<ChapterSource | null>(null)
  const [fromCache, setFromCache] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('Starting…')
  const [copied, setCopied] = useState(false)
  const [videoJobPending, setVideoJobPending] = useState(false)
  const [resolvingStatus, setResolvingStatus] = useState(true)
  const [staleBlocked, setStaleBlocked] = useState(false)
  const [regenerateQuota, setRegenerateQuota] = useState<RegenerateQuota>({
    allowed: true,
    remaining: 2,
    retryAfterMs: 0,
  })

  const refreshRegenerateQuota = useCallback(async () => {
    const quota = (await sendMessage({ type: 'GET_REGENERATE_QUOTA' })) as RegenerateQuota
    setRegenerateQuota(quota)
  }, [])

  const applyResult = useCallback(
    (result: {
      error?: string
      chapters?: Chapter[]
      source?: ChapterSource
      cached?: boolean
    }) => {
      if (result.error) {
        setChapters([])
        setSource(null)
        setFromCache(false)
        setError(result.error)
        return
      }

      setChapters(result.chapters ?? [])
      setSource(result.source ?? 'ai')
      setFromCache(Boolean(result.cached))
      setError(null)
    },
    [],
  )

  useEffect(() => {
    const onMessage = (message: {
      type?: string
      payload?: { videoId?: string; progress?: number; label?: string }
    }) => {
      if (message?.type !== 'CHAPTER_PROGRESS' || !message.payload) return
      const payloadVideoId = message.payload.videoId
      if (payloadVideoId && videoContext?.videoId && payloadVideoId !== videoContext.videoId) {
        return
      }
      if (message.payload.label) setProgressLabel(message.payload.label)
      if (typeof message.payload.progress === 'number') {
        const next = message.payload.progress
        setProgress((current) => Math.max(current, next))
      }
    }

    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [videoContext?.videoId])

  const loadChapters = useCallback(
    async (context: VideoContext, regenerate = false) => {
      setLoading(true)
      setError(null)
      if (!regenerate) {
        setChapters([])
        setSource(null)
        setFromCache(false)
      }
      setProgress(regenerate ? 15 : 5)
      setProgressLabel(regenerate ? 'Reading transcript…' : 'Starting…')
      setVideoJobPending(true)

      try {
        const result = (await sendMessage(
          regenerate
            ? { type: 'REGENERATE_CHAPTERS', payload: { videoId: context.videoId } }
            : {
                type: 'GENERATE_CHAPTERS',
                payload: {
                  videoId: context.videoId,
                  title: context.title,
                  durationSeconds: context.durationSeconds,
                },
              },
        )) as {
          error?: string
          chapters?: Chapter[]
          source?: ChapterSource
          cached?: boolean
          retryAfterMs?: number
        }

        if (result?.error) throw new Error(result.error)

        applyResult(result)
      } catch (err) {
        setChapters([])
        setSource(null)
        setFromCache(false)
        setError(err instanceof Error ? err.message : 'Failed to load chapters')
      } finally {
        setLoading(false)
        setVideoJobPending(false)
        void refreshRegenerateQuota()
      }
    },
    [applyResult, refreshRegenerateQuota],
  )

  useEffect(() => {
    if (!videoContext) return

    let cancelled = false
    const context = videoContext

    void (async () => {
      const [jobStatus, quota, cached] = await Promise.all([
        sendMessage({
          type: 'GET_CHAPTER_JOB_STATUS',
          payload: { videoId: context.videoId },
        }) as Promise<ChapterJobStatusResponse>,
        sendMessage({ type: 'GET_REGENERATE_QUOTA' }) as Promise<RegenerateQuota>,
        sendMessage({
          type: 'GET_CHAPTER_CACHE',
          payload: { videoId: context.videoId },
        }) as Promise<{
          chapters?: Chapter[]
          source?: ChapterSource
          cached?: boolean
        } | null>,
      ])

      if (cancelled) return

      const hasCache = Boolean(cached?.chapters?.length)
      const snapshot = jobStatus.snapshot
      const hasSnapshot =
        snapshot?.status === 'done' || snapshot?.status === 'error'
      const hasRunningJob = Boolean(jobStatus.pending)

      if (context.needsRefresh && !hasCache && !hasSnapshot && !hasRunningJob) {
        setStaleBlocked(true)
        setResolvingStatus(false)
        return
      }

      setStaleBlocked(false)
      setRegenerateQuota(quota)

      if (hasCache && cached) {
        applyResult(cached)
        setLoading(false)
        setResolvingStatus(false)
        setVideoJobPending(false)
        return
      }

      setVideoJobPending(Boolean(jobStatus.pending))

      if (snapshot?.status === 'done' && snapshot.result) {
        applyResult(snapshot.result)
        setLoading(false)
        setResolvingStatus(false)
        return
      }

      if (snapshot?.status === 'error' && snapshot.result) {
        applyResult(snapshot.result)
        setLoading(false)
        setResolvingStatus(false)
        return
      }

      setResolvingStatus(false)
      setCopied(false)

      if (snapshot?.status === 'running') {
        setLoading(true)
        setProgress((current) => Math.max(current, snapshot.progress))
        setProgressLabel(snapshot.label)
        setError(null)
      } else {
        setLoading(true)
        setChapters([])
        setSource(null)
        setFromCache(false)
        setError(null)
        setProgress(5)
        setProgressLabel('Starting…')
      }

      try {
        const result = (await sendMessage({
          type: 'GENERATE_CHAPTERS',
          payload: {
            videoId: context.videoId,
            title: context.title,
            durationSeconds: context.durationSeconds,
          },
        })) as {
          error?: string
          chapters?: Chapter[]
          source?: ChapterSource
          cached?: boolean
        }

        if (cancelled) return
        if (result?.error) throw new Error(result.error)

        applyResult(result)
      } catch (err) {
        if (cancelled) return
        setChapters([])
        setSource(null)
        setFromCache(false)
        setError(err instanceof Error ? err.message : 'Failed to load chapters')
      } finally {
        if (!cancelled) {
          setLoading(false)
          setVideoJobPending(false)
          void refreshRegenerateQuota()
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [applyResult, refreshRegenerateQuota, videoContext])

  useEffect(() => {
    if (!loading || !videoContext || !videoJobPending) return

    const videoId = videoContext.videoId
    const interval = window.setInterval(() => {
      void sendMessage({
        type: 'GET_CHAPTER_JOB_STATUS',
        payload: { videoId },
      })
        .then((jobStatus) => {
          const status = jobStatus as ChapterJobStatusResponse
          const snapshot = status.snapshot
          if (snapshot?.status !== 'running') return
          setProgress((current) => Math.max(current, snapshot.progress))
          if (snapshot.label) setProgressLabel(snapshot.label)
        })
        .catch(() => undefined)
    }, 800)

    return () => window.clearInterval(interval)
  }, [loading, videoContext, videoJobPending])

  const handleSeek = (seconds: number) => {
    void sendMessage({ type: 'SEEK_TO', payload: { seconds } })
  }

  const handleCopyChapters = async () => {
    try {
      await navigator.clipboard.writeText(formatChaptersForClipboard(chapters))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard may be unavailable in some popup contexts.
    }
  }

  const regenerateDisabled =
    loading ||
    videoJobPending ||
    !regenerateQuota.allowed ||
    !fromCache ||
    source !== 'ai'

  const retryDisabled = loading || videoJobPending

  if (!videoContext || staleBlocked) {
    return (
      <div className="text-sm text-[var(--yn-muted)]">
        <button
          type="button"
          onClick={onRefreshTab}
          className="text-[var(--yn-accent)] hover:underline"
        >
          Refresh
        </button>{' '}
        to load video
      </div>
    )
  }

  if (loading || resolvingStatus) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-[var(--yn-muted)]">
          <span>{resolvingStatus ? 'Loading…' : progressLabel}</span>
          {!resolvingStatus ? (
            <span className="font-mono tabular-nums">{Math.round(progress)}%</span>
          ) : null}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--yn-surface)]">
          <div
            className="h-full rounded-full bg-[var(--yn-accent)] transition-[width] duration-300 ease-out"
            style={{ width: `${resolvingStatus ? 8 : progress}%` }}
          />
        </div>
        {source === 'ai' ? (
          <button
            type="button"
            disabled
            className="text-xs text-[var(--yn-muted)] opacity-50 cursor-not-allowed"
          >
            Regenerate
          </button>
        ) : null}
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-2">
        <div className="text-sm text-red-400">{error}</div>
        <button
          type="button"
          disabled={retryDisabled}
          onClick={() => void loadChapters(videoContext, false)}
          className="text-xs text-[var(--yn-accent)] hover:underline disabled:cursor-not-allowed disabled:text-[var(--yn-muted)] disabled:opacity-50 disabled:no-underline"
        >
          Regenerate
        </button>
      </div>
    )
  }

  if (!chapters.length) {
    return <div className="text-sm text-[var(--yn-muted)]">No chapters available.</div>
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-semibold leading-snug">{videoContext.title}</div>
        {source ? <div className="mt-1 text-xs text-[var(--yn-muted)]">{sourceLabel(source)}</div> : null}
      </div>

      <div className="flex items-center justify-between gap-2">
        {source === 'ai' ? (
          <button
            type="button"
            disabled={regenerateDisabled}
            onClick={() => void loadChapters(videoContext, true)}
            className="text-xs text-[var(--yn-accent)] hover:underline disabled:cursor-not-allowed disabled:text-[var(--yn-muted)] disabled:opacity-50 disabled:no-underline"
          >
            Regenerate
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => void handleCopyChapters()}
          aria-label="Copy chapters"
          className="shrink-0 rounded-md p-1.5 text-[var(--yn-muted)] transition-colors hover:bg-[var(--yn-surface)] hover:text-[var(--yn-accent)]"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>

      <div className="max-h-56 space-y-1 overflow-y-auto border-t border-[var(--yn-border)] pt-2">
        {chapters.map((chapter) => (
          <button
            key={`${chapter.startSeconds}-${chapter.title}`}
            type="button"
            onClick={() => handleSeek(chapter.startSeconds)}
            className="flex w-full items-start gap-2 rounded-md px-1 py-1.5 text-left hover:bg-[var(--yn-surface)]"
          >
            <span className="min-w-[48px] font-mono text-xs text-[var(--yn-accent)]">
              {formatTimestamp(chapter.startSeconds)}
            </span>
            <span className="text-sm leading-5">{chapter.title}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
