import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Chapter, ChapterSource } from '../../shared/types/chapter'
import type { ChapterJobStatusResponse } from '../../shared/types/chapter-job'
import type { RegenerateQuota } from '../../shared/types/regenerate'
import type { VideoContext } from '../../shared/types/video'
import { sendMessage } from '../../shared/messaging/send-message'
import { formatChaptersForClipboard } from '../../shared/utils/chapter-clipboard'
import { formatTimestamp } from '../../shared/utils/format-duration'
import { getNextQuotaResetAtIso, isSuccessQuotaExhausted } from '../../shared/utils/quota-reset'
import { RegenerateFeedback } from './RegenerateFeedback'
import { RegenerateModal } from './RegenerateModal'

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

const DEFAULT_QUOTA: RegenerateQuota = {
  successful: { used: 0, limit: 5, remaining: 5 },
  denied: { used: 0, limit: 3, remaining: 3 },
  resetsAt: getNextQuotaResetAtIso(),
  onCooldown: false,
}

function sourceLabel(source: ChapterSource): string {
  return source === 'youtube' ? 'YouTube chapters' : 'AI chapters'
}

function isVideoContext(value: unknown): value is VideoContext {
  return Boolean(value && typeof value === 'object' && 'videoId' in value)
}

async function fetchLiveVideoContext(): Promise<VideoContext | null> {
  const live = await sendMessage({ type: 'GET_VIDEO_CONTEXT' }).catch(() => null)
  return isVideoContext(live) ? live : null
}

export function ChaptersPanel({ videoContext, onRefreshTab }: ChaptersPanelProps) {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<ChapterSource | null>(null)
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('Starting…')
  const [copied, setCopied] = useState(false)
  const [videoJobPending, setVideoJobPending] = useState(false)
  const [resolvingStatus, setResolvingStatus] = useState(true)
  const [staleBlocked, setStaleBlocked] = useState(false)
  const [regenerateQuota, setRegenerateQuota] = useState<RegenerateQuota>(DEFAULT_QUOTA)
  const [showRegenerateModal, setShowRegenerateModal] = useState(false)
  const [regenerateModalKey, setRegenerateModalKey] = useState(0)
  const [pendingStagingId, setPendingStagingId] = useState<string | null>(null)
  const [stagingVideoId, setStagingVideoId] = useState<string | null>(null)
  const [feedbackThanks, setFeedbackThanks] = useState<string | null>(null)
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)
  const [chapterLoadToken, setChapterLoadToken] = useState(0)

  const refreshRegenerateQuota = useCallback(async (videoId?: string): Promise<RegenerateQuota> => {
    const raw = (await sendMessage({
      type: 'GET_REGENERATE_QUOTA',
      payload: videoId ? { videoId } : undefined,
    })) as RegenerateQuota | undefined

    const quota: RegenerateQuota =
      raw?.successful && raw?.denied
        ? { ...raw, resetsAt: raw.resetsAt || getNextQuotaResetAtIso() }
        : { ...DEFAULT_QUOTA, resetsAt: getNextQuotaResetAtIso() }

    setRegenerateQuota(quota)
    return quota
  }, [])

  const applyResult = useCallback(
    (result: {
      error?: string
      chapters?: Chapter[]
      source?: ChapterSource
      cached?: boolean
      stagingId?: string
      needsFeedback?: boolean
      pendingFeedback?: { stagingId: string; feedbackSubmitted: boolean }
    }) => {
      if (result.error) {
        setError(result.error)
        setPendingStagingId(null)
        setStagingVideoId(null)
        setFeedbackThanks(null)
        if (result.chapters?.length) {
          setChapters(result.chapters)
          setSource(result.source ?? 'ai')
        }
        return
      }

      setChapters(result.chapters ?? [])
      setSource(result.source ?? 'ai')
      setError(null)

      const cachedPending =
        result.pendingFeedback &&
        !result.pendingFeedback.feedbackSubmitted &&
        result.pendingFeedback.stagingId

      if (cachedPending) {
        setPendingStagingId(result.pendingFeedback!.stagingId)
        setStagingVideoId(videoContext?.videoId ?? null)
      } else if (result.needsFeedback && result.stagingId) {
        setPendingStagingId(result.stagingId)
        setStagingVideoId(videoContext?.videoId ?? null)
        setFeedbackThanks(null)
      } else {
        setPendingStagingId(null)
        setStagingVideoId(null)
        setFeedbackThanks(null)
      }
    },
    [videoContext?.videoId],
  )

  const showFeedback =
    stagingVideoId === videoContext?.videoId && Boolean(pendingStagingId || feedbackThanks)

  const showRunningLoader = useCallback((snapshot?: ChapterJobStatusResponse['snapshot']) => {
    setLoading(true)
    setVideoJobPending(true)
    setResolvingStatus(false)
    setError(null)
    if (snapshot?.status === 'running') {
      setProgress((current) => Math.max(current, snapshot.progress))
      setProgressLabel(snapshot.label || 'Regenerating chapters…')
    } else {
      setProgress((current) => Math.max(current, 5))
      setProgressLabel('Regenerating chapters…')
    }
  }, [])

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
      setLoading(true)
      setVideoJobPending(true)
      setResolvingStatus(false)
      if (message.payload.label) setProgressLabel(message.payload.label)
      if (typeof message.payload.progress === 'number') {
        const next = message.payload.progress
        setProgress((current) => Math.max(current, next))
      }
    }

    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [videoContext?.videoId])

  const runRegenerate = useCallback(
    async (context: VideoContext, reason: string) => {
      showRunningLoader()
      setProgress(15)
      setProgressLabel('Reading transcript…')

      try {
        const result = (await sendMessage({
          type: 'REGENERATE_CHAPTERS',
          payload: { videoId: context.videoId, reason },
        })) as {
          error?: string
          chapters?: Chapter[]
          source?: ChapterSource
          cached?: boolean
          stagingId?: string
          needsFeedback?: boolean
        }

        if (result?.error) throw new Error(result.error)

        applyResult(result)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to regenerate chapters'
        void sendMessage({
          type: 'CLEAR_CHAPTER_JOB_SNAPSHOT',
          payload: { videoId: context.videoId },
        })
        const cached = (await sendMessage({
          type: 'GET_CHAPTER_CACHE',
          payload: { videoId: context.videoId },
        })) as {
          chapters?: Chapter[]
          source?: ChapterSource
          pendingFeedback?: { stagingId: string; feedbackSubmitted: boolean }
        } | null
        applyResult({
          error: message,
          chapters: cached?.chapters,
          source: cached?.source,
          pendingFeedback: cached?.pendingFeedback,
        })
      } finally {
        setLoading(false)
        setVideoJobPending(false)
        void refreshRegenerateQuota(context.videoId)
      }
    },
    [applyResult, refreshRegenerateQuota, showRunningLoader],
  )

  const regenerateDisabled =
    loading ||
    videoJobPending ||
    source !== 'ai' ||
    chapters.length === 0

  const openRegenerateModal = async () => {
    if (!videoContext) return
    await refreshRegenerateQuota(videoContext.videoId)
    setRegenerateModalKey((current) => current + 1)
    setShowRegenerateModal(true)
  }

  const handleRegenerateSubmit = useCallback(
    async (reason: string) => {
      if (!videoContext) return
      showRunningLoader()
      setProgress(5)
      setProgressLabel('Starting…')

      const quota = await refreshRegenerateQuota(videoContext.videoId)
      if (quota.onCooldown) {
        setLoading(false)
        setVideoJobPending(false)
        setShowRegenerateModal(true)
        return
      }
      if (isSuccessQuotaExhausted(quota)) {
        setLoading(false)
        setVideoJobPending(false)
        setShowRegenerateModal(true)
        return
      }

      setShowRegenerateModal(false)
      void runRegenerate(videoContext, reason)
    },
    [refreshRegenerateQuota, runRegenerate, showRunningLoader, videoContext],
  )

  const dismissFeedbackThanks = useCallback(() => setFeedbackThanks(null), [])

  const handleFeedback = useCallback(
    async (satisfied: boolean) => {
      if (!pendingStagingId) return

      const videoId = videoContext?.videoId ?? stagingVideoId
      if (!videoId) return

      setPendingStagingId(null)
      setFeedbackThanks('Thanks for your feedback!')
      setFeedbackSubmitting(true)

      try {
        const result = (await sendMessage({
          type: 'SUBMIT_REGENERATE_FEEDBACK',
          payload: {
            stagingId: pendingStagingId,
            videoId,
            satisfied,
          },
        })) as { message?: string; error?: string } | undefined

        if (!result || typeof result !== 'object') {
          throw new Error('Failed to submit feedback')
        }
        if (result.error) throw new Error(result.error)

        setFeedbackThanks(result.message ?? 'Thanks for your feedback!')
        if (satisfied && videoContext) {
          void refreshRegenerateQuota(videoContext.videoId)
        }
      } catch (err) {
        setFeedbackThanks(null)
        setPendingStagingId(pendingStagingId)
        setError(err instanceof Error ? err.message : 'Failed to submit feedback')
      } finally {
        setFeedbackSubmitting(false)
      }
    },
    [pendingStagingId, refreshRegenerateQuota, stagingVideoId, videoContext],
  )

  useEffect(() => {
    if (!videoContext) return

    let cancelled = false
    const context = videoContext

    void (async () => {
      const [jobStatus, cached] = await Promise.all([
        sendMessage({
          type: 'GET_CHAPTER_JOB_STATUS',
          payload: { videoId: context.videoId },
        }) as Promise<ChapterJobStatusResponse>,
        sendMessage({
          type: 'GET_CHAPTER_CACHE',
          payload: { videoId: context.videoId },
        }) as Promise<{
          chapters?: Chapter[]
          source?: ChapterSource
          cached?: boolean
          pendingFeedback?: { stagingId: string; feedbackSubmitted: boolean }
        } | null>,
      ])

      if (cancelled) return

      const liveContext = await fetchLiveVideoContext()
      const needsRefresh =
        liveContext?.videoId === context.videoId
          ? Boolean(liveContext.needsRefresh)
          : Boolean(context.needsRefresh)

      const hasCache = Boolean(cached?.chapters?.length)
      const snapshot = jobStatus.snapshot
      const hasSnapshot =
        snapshot?.status === 'done' || snapshot?.status === 'error'
      const hasRunningJob = Boolean(jobStatus.pending)

      if (needsRefresh && !hasCache && !hasSnapshot && !hasRunningJob) {
        setStaleBlocked(true)
        setResolvingStatus(false)
        return
      }

      setStaleBlocked(false)

      const isRunning = hasRunningJob

      if (isRunning) {
        showRunningLoader(snapshot ?? undefined)
        return
      }

      if (hasCache && cached) {
        applyResult(cached)
        setLoading(false)
        setResolvingStatus(false)
        setVideoJobPending(false)

        if (snapshot?.status === 'error' && snapshot.result?.error) {
          setError(snapshot.result.error)
          void sendMessage({
            type: 'CLEAR_CHAPTER_JOB_SNAPSHOT',
            payload: { videoId: context.videoId },
          })
        }
        return
      }

      if (snapshot?.status === 'done' && snapshot.result) {
        applyResult(snapshot.result)
        setLoading(false)
        setResolvingStatus(false)
        setVideoJobPending(false)
        void sendMessage({
          type: 'CLEAR_CHAPTER_JOB_SNAPSHOT',
          payload: { videoId: context.videoId },
        })
        return
      }

      if (snapshot?.status === 'error' && snapshot.result) {
        applyResult(snapshot.result)
        setLoading(false)
        setResolvingStatus(false)
        setVideoJobPending(false)
        void sendMessage({
          type: 'CLEAR_CHAPTER_JOB_SNAPSHOT',
          payload: { videoId: context.videoId },
        })
        return
      }

      setVideoJobPending(false)

      setResolvingStatus(false)
      setCopied(false)
      setLoading(true)
      setVideoJobPending(true)
      setChapters([])
      setSource(null)
      setError(null)
      setProgress(5)
      setProgressLabel('Starting…')

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
        setError(err instanceof Error ? err.message : 'Failed to load chapters')
      } finally {
        if (!cancelled) {
          setLoading(false)
          setVideoJobPending(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [applyResult, showRunningLoader, videoContext?.videoId, chapterLoadToken])

  useEffect(() => {
    if (!staleBlocked || !videoContext) return

    let cancelled = false
    const interval = window.setInterval(() => {
      void fetchLiveVideoContext().then((live) => {
        if (cancelled || !live || live.videoId !== videoContext.videoId) return
        if (!live.needsRefresh) {
          setStaleBlocked(false)
          setChapterLoadToken((token) => token + 1)
        }
      })
    }, 1500)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [staleBlocked, videoContext])

  useEffect(() => {
    if (!videoJobPending || !videoContext) return

    const videoId = videoContext.videoId

    const pollJobStatus = () => {
      void sendMessage({
        type: 'GET_CHAPTER_JOB_STATUS',
        payload: { videoId },
      })
        .then((jobStatus) => {
          const status = jobStatus as ChapterJobStatusResponse
          const snapshot = status.snapshot

          if (status.pending || snapshot?.status === 'running') {
            showRunningLoader(snapshot ?? undefined)
            return
          }

          if (snapshot?.status === 'done' && snapshot.result) {
            applyResult(snapshot.result)
            setLoading(false)
            setVideoJobPending(false)
            setResolvingStatus(false)
            void sendMessage({
              type: 'CLEAR_CHAPTER_JOB_SNAPSHOT',
              payload: { videoId },
            })
            return
          }

          if (snapshot?.status === 'error' && snapshot.result) {
            applyResult(snapshot.result)
            setLoading(false)
            setVideoJobPending(false)
            setResolvingStatus(false)
            void sendMessage({
              type: 'CLEAR_CHAPTER_JOB_SNAPSHOT',
              payload: { videoId },
            })
          }
        })
        .catch(() => undefined)
    }

    pollJobStatus()
    const interval = window.setInterval(pollJobStatus, 800)
    return () => window.clearInterval(interval)
  }, [applyResult, showRunningLoader, videoContext?.videoId, videoJobPending])

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

  const retryDisabled = loading || videoJobPending

  let panelBody: ReactNode

  if (!videoContext || staleBlocked) {
    panelBody = (
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
  } else if (loading || resolvingStatus) {
    panelBody = (
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
      </div>
    )
  } else if (error && !chapters.length) {
    panelBody = (
      <div className="space-y-2">
        <div className="text-sm text-red-400">{error}</div>
        <button
          type="button"
          disabled={retryDisabled}
          onClick={() => {
            setError(null)
            void sendMessage({
              type: 'CLEAR_CHAPTER_JOB_SNAPSHOT',
              payload: { videoId: videoContext.videoId },
            })
            setChapterLoadToken((token) => token + 1)
          }}
          className="text-xs text-[var(--yn-accent)] hover:underline disabled:cursor-not-allowed disabled:text-[var(--yn-muted)] disabled:opacity-50 disabled:no-underline"
        >
          Retry
        </button>
      </div>
    )
  } else if (!chapters.length) {
    panelBody = <div className="text-sm text-[var(--yn-muted)]">No chapters available.</div>
  } else {
    panelBody = (
      <div className="space-y-3">
        {error ? (
          <div className="space-y-2">
            <div className="text-sm text-red-400">{error}</div>
            <button
              type="button"
              disabled={retryDisabled}
              onClick={() => {
                setError(null)
                void sendMessage({
                  type: 'CLEAR_CHAPTER_JOB_SNAPSHOT',
                  payload: { videoId: videoContext.videoId },
                })
              }}
              className="text-xs text-[var(--yn-accent)] hover:underline disabled:cursor-not-allowed disabled:text-[var(--yn-muted)] disabled:opacity-50 disabled:no-underline"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        <div>
          <div className="text-sm font-semibold leading-snug">{videoContext.title}</div>
          {source ? (
            <div className="mt-1 text-xs text-[var(--yn-muted)]">{sourceLabel(source)}</div>
          ) : null}
        </div>

        {showFeedback ? (
          <RegenerateFeedback
            onFeedback={(satisfied) => void handleFeedback(satisfied)}
            submitting={feedbackSubmitting}
            thanksMessage={feedbackThanks}
            onThanksDismiss={dismissFeedbackThanks}
          />
        ) : null}

        <div className="flex items-center justify-between gap-2">
          {source === 'ai' && !showRegenerateModal ? (
            <button
              type="button"
              disabled={regenerateDisabled}
              onClick={() => void openRegenerateModal()}
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

        {showRegenerateModal ? (
          <RegenerateModal
            key={regenerateModalKey}
            open={showRegenerateModal}
            quota={regenerateQuota}
            loading={loading || videoJobPending}
            onClose={() => setShowRegenerateModal(false)}
            onSubmit={(reason) => void handleRegenerateSubmit(reason)}
          />
        ) : null}

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

  return panelBody
}
