import { useCallback, useEffect, useState } from 'react'
import type { PlaylistDurationResult } from '../shared/types/playlist'
import type { VideoContext } from '../shared/types/video'
import { hasPlaylistDetails } from '../shared/utils/playlist-details'
import { getPlaylistIdFromUrl, getVideoIdFromUrl, isWatchUrl } from '../shared/utils/youtube-url'
import { sendMessage, sendMessageToTab } from '../shared/messaging/send-message'
import { ChaptersPanel } from './components/ChaptersPanel'
import { ExtensionIcon } from './components/ExtensionIcon'
import { PlaylistDurationPanel } from './components/PlaylistDurationPanel'

const CREDITS_LINKEDIN_URL = 'https://www.linkedin.com/in/koushan-de-04a966192'
const SUPPORT_BMC_URL = 'https://buymeacoffee.com/koushan'
const PLAYLIST_LOAD_TIMEOUT_MS = 8000

function BuyMeCoffeeIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M3 8h1v7a3 3 0 0 0 3 3h8.5a4.5 4.5 0 0 0 0-9H17V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v1Zm3-1h10v1H6V7Zm11 3h.5a2.5 2.5 0 0 1 0 5H18v-5ZM6 20h8a1 1 0 0 0 1-1v-1H5v1a1 1 0 0 0 1 1Z" />
    </svg>
  )
}

async function fetchPlaylistDuration(
  tabId: number,
  playlistId: string,
): Promise<PlaylistDurationResult | null> {
  try {
    const response = (await sendMessageToTab(tabId, {
      type: 'GET_PLAYLIST_DURATION',
      payload: { playlistId },
    })) as { result?: PlaylistDurationResult | null } | undefined
    const result = response?.result ?? null
    if (result && result.playlistId !== playlistId) return null
    return result
  } catch {
    return null
  }
}

function PlaylistDurationLoader({
  tabId,
  playlistId,
}: {
  tabId: number
  playlistId: string
}) {
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [result, setResult] = useState<PlaylistDurationResult | null>(null)

  useEffect(() => {
    let cancelled = false
    const loadStartedAt = Date.now()

    const applyResult = (data: PlaylistDurationResult | null) => {
      if (!hasPlaylistDetails(data)) {
        setResult(null)
        const timedOut = Date.now() - loadStartedAt >= PLAYLIST_LOAD_TIMEOUT_MS
        setLoading(!timedOut)
        setFailed(timedOut)
        return
      }

      setResult(data)
      setLoading(false)
      setFailed(false)
    }

    const refresh = async () => {
      const tab = await chrome.tabs.get(tabId)
      const currentPlaylistId = getPlaylistIdFromUrl(tab.url ?? '')
      if (!currentPlaylistId || currentPlaylistId !== playlistId) {
        if (!cancelled) {
          setResult(null)
          const timedOut = Date.now() - loadStartedAt >= PLAYLIST_LOAD_TIMEOUT_MS
          setLoading(!timedOut)
          setFailed(timedOut)
        }
        return
      }

      const data = await fetchPlaylistDuration(tabId, playlistId)
      if (!cancelled) applyResult(data)
    }

    void refresh()
    const timer = setInterval(() => void refresh(), 1500)
    const timeout = setTimeout(() => {
      if (cancelled) return
      setFailed(true)
      setLoading(false)
    }, PLAYLIST_LOAD_TIMEOUT_MS)

    const onUpdate = (message: { type?: string; payload?: PlaylistDurationResult }) => {
      if (message.type !== 'PLAYLIST_DURATIONS_UPDATED' || !message.payload) return
      if (message.payload.playlistId !== playlistId) return
      if (!hasPlaylistDetails(message.payload)) return
      setResult(message.payload)
      setLoading(false)
      setFailed(false)
    }

    chrome.runtime.onMessage.addListener(onUpdate)

    return () => {
      cancelled = true
      clearInterval(timer)
      clearTimeout(timeout)
      chrome.runtime.onMessage.removeListener(onUpdate)
    }
  }, [tabId, playlistId])

  return <PlaylistDurationPanel result={result} loading={loading} failed={failed} />
}

export default function App() {
  const [onPlaylistPage, setOnPlaylistPage] = useState(false)
  const [onWatchPage, setOnWatchPage] = useState(false)
  const [activeTabId, setActiveTabId] = useState<number | null>(null)
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null)
  const [videoContext, setVideoContext] = useState<VideoContext | null>(null)
  const [playlistExpanded, setPlaylistExpanded] = useState(false)
  const [chaptersExpanded, setChaptersExpanded] = useState(false)

  const resolveVideoContext = useCallback(async (): Promise<VideoContext | null> => {
    const isContext = (value: unknown): value is VideoContext =>
      Boolean(value && typeof value === 'object' && 'videoId' in value)

    let tabUrl: string | undefined

    if (activeTabId !== null) {
      try {
        const tab = await chrome.tabs.get(activeTabId)
        tabUrl = tab.url
      } catch {
        tabUrl = undefined
      }

      const fromTab = await sendMessageToTab(activeTabId, { type: 'GET_VIDEO_CONTEXT' })
      if (isContext(fromTab)) {
        const urlVideoId = getVideoIdFromUrl(tabUrl ?? '')
        if (!urlVideoId || fromTab.videoId === urlVideoId) return fromTab
      }
    }

    const fromWorker = await sendMessage({ type: 'GET_VIDEO_CONTEXT' }).catch(() => null)
    if (isContext(fromWorker)) {
      const urlVideoId = getVideoIdFromUrl(tabUrl ?? '')
      if (!urlVideoId || fromWorker.videoId === urlVideoId) return fromWorker
    }

    return null
  }, [activeTabId])

  const refreshActiveTab = useCallback(() => {
    const reloadTab = (tabId: number) => {
      setVideoContext((current) =>
        current ? { ...current, needsRefresh: false } : current,
      )

      void chrome.tabs.reload(tabId)

      const onUpdated = (updatedId: number, changeInfo: { status?: string }) => {
        if (updatedId !== tabId || changeInfo.status !== 'complete') return
        chrome.tabs.onUpdated.removeListener(onUpdated)
        void resolveVideoContext().then((context) => {
          if (context) setVideoContext(context)
        })
      }
      chrome.tabs.onUpdated.addListener(onUpdated)
    }

    if (activeTabId !== null) {
      reloadTab(activeTabId)
      return
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (tabId !== undefined) reloadTab(tabId)
    })
  }, [activeTabId, resolveVideoContext])

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      const url = tab?.url ?? ''
      setOnPlaylistPage(getPlaylistIdFromUrl(url) !== null)
      setOnWatchPage(isWatchUrl(url))
      setActiveTabId(tab?.id ?? null)
      setActivePlaylistId(getPlaylistIdFromUrl(url))
    })
  }, [])

  useEffect(() => {
    if (!chaptersExpanded) return

    let cancelled = false

    const refresh = () => {
      void resolveVideoContext().then((context) => {
        if (!cancelled) setVideoContext(context)
      })
    }

    refresh()

    const onVideoContext = (message: { type?: string; payload?: VideoContext }) => {
      if (message?.type !== 'VIDEO_CONTEXT' || !message.payload?.videoId) return
      setVideoContext((current) => {
        if (current?.videoId === message.payload!.videoId) {
          return { ...current, ...message.payload! }
        }
        return message.payload!
      })
    }

    chrome.runtime.onMessage.addListener(onVideoContext)
    const interval = window.setInterval(refresh, 1500)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      chrome.runtime.onMessage.removeListener(onVideoContext)
    }
  }, [chaptersExpanded, activeTabId, resolveVideoContext])

  const togglePlaylistDuration = () => {
    setPlaylistExpanded((open) => !open)
  }

  const toggleChapters = () => {
    setChaptersExpanded((open) => !open)
  }

  const chaptersPanelKey = videoContext
    ? `${videoContext.videoId}:${videoContext.needsRefresh ? 'stale' : 'fresh'}`
    : 'pending'

  return (
    <div className="w-[340px] p-5">
      <header className="mb-5">
        <div className="grid grid-cols-[2rem_1fr] items-center gap-x-2.5 gap-y-1.5">
          <ExtensionIcon className="col-start-1 row-span-2 h-8 w-8 self-start" />
          <h1 className="yn-popup-title col-start-2 row-start-1 text-base text-[var(--yn-text)]">
            Study Buddy for YouTube
          </h1>
          <p className="yn-popup-tagline col-start-2 row-start-2 text-[0.8125rem] text-[var(--yn-muted)]">
            Playlist duration on list pages. Chapters on watch pages.
          </p>
        </div>
      </header>

      <div className="mb-3 rounded-xl border border-[var(--yn-border)]">
        <button
          type="button"
          disabled={!onPlaylistPage}
          onClick={togglePlaylistDuration}
          className="flex w-full items-center justify-between px-3.5 py-3 text-left text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>Playlist duration</span>
          <span className="text-xs text-[var(--yn-muted)]">{playlistExpanded ? 'Hide' : 'Show'}</span>
        </button>

        {playlistExpanded && activeTabId !== null && activePlaylistId !== null && (
          <div className="border-t border-[var(--yn-border)] px-3.5 py-3">
            <PlaylistDurationLoader
              key={activePlaylistId}
              tabId={activeTabId}
              playlistId={activePlaylistId}
            />
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[var(--yn-border)]">
        <button
          type="button"
          disabled={!onWatchPage}
          onClick={toggleChapters}
          className="flex w-full items-center justify-between px-3.5 py-3 text-left text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>AI chapters</span>
          <span className="text-xs text-[var(--yn-muted)]">{chaptersExpanded ? 'Hide' : 'Show'}</span>
        </button>

        <div
          className={`border-t border-[var(--yn-border)] px-3.5 py-3 ${chaptersExpanded ? '' : 'hidden'}`}
        >
          <ChaptersPanel
            key={chaptersPanelKey}
            videoContext={videoContext}
            onRefreshTab={refreshActiveTab}
          />
        </div>
      </div>

      {!onPlaylistPage && !onWatchPage && (
        <p className="yn-popup-tagline mt-3 text-xs text-[var(--yn-muted)]">
          Open a playlist or video on YouTube to get started.
        </p>
      )}

      <footer className="yn-popup-credits mt-5 flex items-center justify-between gap-3 border-t border-[var(--yn-border)] pt-3 text-xs text-[var(--yn-muted)]">
        <p className="m-0 leading-none">
          Made by{' '}
          <a
            href={CREDITS_LINKEDIN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--yn-accent)] hover:underline"
          >
            Koushan De
          </a>
        </p>
        <a
          href={SUPPORT_BMC_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Buy me a coffee"
          className="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 leading-none text-[var(--yn-muted)] transition-colors hover:bg-[var(--yn-surface)] hover:text-[var(--yn-accent)]"
        >
          <BuyMeCoffeeIcon className="h-4 w-4" />
        </a>
      </footer>
    </div>
  )
}
