import { useCallback, useEffect, useState } from 'react'
import type { Chapter, ChapterSource } from '../../shared/types/chapter'
import { sendMessage } from '../../shared/messaging/send-message'
import { formatTimestamp } from '../../shared/utils/format-duration'

interface VideoContext {
  videoId: string
  title: string
  durationSeconds: number
}

interface ChaptersPanelProps {
  videoContext: VideoContext | null
  enabled: boolean
}

function sourceLabel(source: ChapterSource): string {
  return source === 'youtube' ? 'YouTube chapters' : 'AI chapters'
}

export function ChaptersPanel({ videoContext, enabled }: ChaptersPanelProps) {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<ChapterSource | null>(null)
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('Starting…')

  // Real milestones come from the service worker; this trickle keeps the bar
  // moving (and decelerating) between them so a long AI step never looks frozen.
  useEffect(() => {
    if (!loading) return

    const id = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 95) return current
        const step = current < 30 ? 2.5 : current < 60 ? 1.2 : current < 85 ? 0.5 : 0.2
        return Math.min(95, current + step)
      })
    }, 350)

    return () => window.clearInterval(id)
  }, [loading])

  // Stage updates from the background act as floors and drive the label.
  useEffect(() => {
    const onMessage = (message: {
      type?: string
      payload?: { videoId?: string; progress?: number; label?: string }
    }) => {
      if (message?.type !== 'CHAPTER_PROGRESS' || !message.payload) return
      if (videoContext && message.payload.videoId && message.payload.videoId !== videoContext.videoId) {
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
  }, [videoContext])

  const loadChapters = useCallback(
    async (context: VideoContext, regenerate = false) => {
      if (!enabled) return

      setLoading(true)
      setError(null)
      setChapters([])
      setSource(null)
      setProgress(5)
      setProgressLabel('Starting…')

      try {
        const result = (await sendMessage(
          regenerate
            ? { type: 'INVALIDATE_CHAPTER_CACHE', payload: { videoId: context.videoId } }
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
        }

        if (result?.error) throw new Error(result.error)

        setChapters(result.chapters ?? [])
        setSource(result.source ?? 'ai')
      } catch (err) {
        setChapters([])
        setSource(null)
        setError(err instanceof Error ? err.message : 'Failed to load chapters')
      } finally {
        setLoading(false)
      }
    },
    [enabled],
  )

  useEffect(() => {
    if (!videoContext || !enabled) {
      setChapters([])
      setSource(null)
      setError(null)
      setLoading(false)
      return
    }

    let cancelled = false
    const context = videoContext

    setChapters([])
    setSource(null)
    setError(null)
    setLoading(true)
    setProgress(5)
    setProgressLabel('Starting…')

    void (async () => {
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
        }

        if (cancelled) return
        if (result?.error) throw new Error(result.error)

        setChapters(result.chapters ?? [])
        setSource(result.source ?? 'ai')
      } catch (err) {
        if (cancelled) return
        setChapters([])
        setSource(null)
        setError(err instanceof Error ? err.message : 'Failed to load chapters')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [videoContext?.videoId, enabled])

  const handleSeek = (seconds: number) => {
    void sendMessage({ type: 'SEEK_TO', payload: { seconds } })
  }

  if (!videoContext) {
    return <div className="text-sm text-[var(--yn-muted)]">Refresh to load video</div>
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-[var(--yn-muted)]">
          <span>{progressLabel}</span>
          <span className="font-mono tabular-nums">{Math.round(progress)}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--yn-surface)]">
          <div
            className="h-full rounded-full bg-[var(--yn-accent)] transition-[width] duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    )
  }

  if (error) {
    return <div className="text-sm text-red-400">{error}</div>
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

      {source && source !== 'youtube' ? (
        <button
          type="button"
          onClick={() => void loadChapters(videoContext, true)}
          className="text-xs text-[var(--yn-accent)] hover:underline"
        >
          Regenerate
        </button>
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
