import { useEffect, useState } from 'react'
import type { PlaylistDurationResult } from '../shared/types/playlist'
import { hasPlaylistDetails } from '../shared/utils/playlist-details'
import { getPlaylistIdFromUrl, getVideoIdFromUrl, isWatchUrl } from '../shared/utils/youtube-url'
import { sendMessage } from '../shared/messaging/send-message'
import { ChaptersPanel } from './components/ChaptersPanel'
import { PlaylistDurationPanel } from './components/PlaylistDurationPanel'
import icon48 from '../../public/icons/icon48.png'

const CREDITS_LINKEDIN_URL = 'https://www.linkedin.com/in/koushan-de-04a966192'

function isPlaylistUrl(url: string | undefined): boolean {
  return getPlaylistIdFromUrl(url ?? '') !== null
}

interface VideoContext {
  videoId: string
  title: string
  durationSeconds: number
}

const PLAYLIST_LOAD_TIMEOUT_MS = 8000

async function fetchPlaylistDuration(
  tabId: number,
  playlistId: string,
): Promise<PlaylistDurationResult | null> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: 'GET_PLAYLIST_DURATION',
      payload: { playlistId },
    })) as { result?: PlaylistDurationResult | null }
    const result = response.result ?? null
    if (result && result.playlistId !== playlistId) return null
    return result
  } catch {
    return null
  }
}

export default function App() {
  const [onPlaylistPage, setOnPlaylistPage] = useState(false)
  const [onWatchPage, setOnWatchPage] = useState(false)
  const [activeTabId, setActiveTabId] = useState<number | null>(null)
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null)
  const [videoContext, setVideoContext] = useState<VideoContext | null>(null)
  const [playlistExpanded, setPlaylistExpanded] = useState(false)
  const [chaptersExpanded, setChaptersExpanded] = useState(false)
  const [playlistLoading, setPlaylistLoading] = useState(false)
  const [playlistFailed, setPlaylistFailed] = useState(false)
  const [playlistResult, setPlaylistResult] = useState<PlaylistDurationResult | null>(null)

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      const url = tab?.url ?? ''
      setOnPlaylistPage(isPlaylistUrl(url))
      setOnWatchPage(isWatchUrl(url))
      setActiveTabId(tab?.id ?? null)
      setActivePlaylistId(getPlaylistIdFromUrl(url))
    })
  }, [])

  useEffect(() => {
    if (!chaptersExpanded) return

    let cancelled = false

    const isContext = (value: unknown): value is VideoContext =>
      Boolean(value && typeof value === 'object' && 'videoId' in value)

    const resolveContext = async (): Promise<VideoContext | null> => {
      let tabUrl: string | undefined

      if (activeTabId !== null) {
        try {
          const tab = await chrome.tabs.get(activeTabId)
          tabUrl = tab.url
        } catch {
          tabUrl = undefined
        }

        const fromTab = await chrome.tabs
          .sendMessage(activeTabId, { type: 'GET_VIDEO_CONTEXT' })
          .catch(() => null)
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
    }

    void resolveContext().then((context) => {
      if (!cancelled) setVideoContext(context)
    })

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

    return () => {
      cancelled = true
      chrome.runtime.onMessage.removeListener(onVideoContext)
    }
  }, [chaptersExpanded, activeTabId])

  useEffect(() => {
    if (!playlistExpanded || activeTabId === null || !activePlaylistId) return

    let cancelled = false
    let loadStartedAt = Date.now()

    const applyResult = (data: PlaylistDurationResult | null) => {
      if (!hasPlaylistDetails(data)) {
        setPlaylistResult(null)
        const timedOut = Date.now() - loadStartedAt >= PLAYLIST_LOAD_TIMEOUT_MS
        setPlaylistLoading(!timedOut)
        setPlaylistFailed(timedOut)
        return
      }

      setPlaylistResult(data)
      setPlaylistLoading(false)
      setPlaylistFailed(false)
    }

    const refresh = async () => {
      const tab = await chrome.tabs.get(activeTabId)
      const playlistId = getPlaylistIdFromUrl(tab.url ?? '')
      if (!playlistId || playlistId !== activePlaylistId) {
        if (!cancelled) {
          setPlaylistResult(null)
          const timedOut = Date.now() - loadStartedAt >= PLAYLIST_LOAD_TIMEOUT_MS
          setPlaylistLoading(!timedOut)
          setPlaylistFailed(timedOut)
        }
        return
      }

      const data = await fetchPlaylistDuration(activeTabId, playlistId)
      if (!cancelled) applyResult(data)
    }

    setPlaylistResult(null)
    setPlaylistLoading(true)
    setPlaylistFailed(false)
    loadStartedAt = Date.now()
    void refresh()
    const timer = setInterval(() => void refresh(), 1500)
    const timeout = setTimeout(() => {
      if (cancelled) return
      setPlaylistFailed(true)
      setPlaylistLoading(false)
    }, PLAYLIST_LOAD_TIMEOUT_MS)

    const onUpdate = (message: { type?: string; payload?: PlaylistDurationResult }) => {
      if (message.type !== 'PLAYLIST_DURATIONS_UPDATED' || !message.payload) return
      if (message.payload.playlistId !== activePlaylistId) return
      if (!hasPlaylistDetails(message.payload)) return
      setPlaylistResult(message.payload)
      setPlaylistLoading(false)
      setPlaylistFailed(false)
    }

    chrome.runtime.onMessage.addListener(onUpdate)

    return () => {
      cancelled = true
      clearInterval(timer)
      clearTimeout(timeout)
      chrome.runtime.onMessage.removeListener(onUpdate)
    }
  }, [playlistExpanded, activeTabId, activePlaylistId])

  const togglePlaylistDuration = () => {
    if (playlistExpanded) {
      setPlaylistExpanded(false)
      setPlaylistResult(null)
      return
    }

    setPlaylistExpanded(true)
    setPlaylistLoading(true)
    setPlaylistFailed(false)
    setPlaylistResult(null)
  }

  const toggleChapters = () => {
    if (chaptersExpanded) {
      setChaptersExpanded(false)
      setVideoContext(null)
      return
    }

    setChaptersExpanded(true)
    setVideoContext(null)
  }

  return (
    <div className="w-[340px] p-5">
      <header className="mb-5">
        <div className="flex items-center gap-2.5">
          <img
            src={icon48}
            alt=""
            className="h-8 w-8 shrink-0 rounded-lg"
            width={32}
            height={32}
          />
          <h1 className="yn-popup-title text-base text-[var(--yn-text)]">
            Study Buddy for YouTube
          </h1>
        </div>
        <p className="yn-popup-tagline mt-1.5 text-[0.8125rem] text-[var(--yn-muted)]">
          Playlist duration on list pages. Chapters on watch pages.
        </p>
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

        {playlistExpanded && (
          <div className="border-t border-[var(--yn-border)] px-3.5 py-3">
            <PlaylistDurationPanel
              result={playlistResult}
              loading={playlistLoading}
              failed={playlistFailed}
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

        {chaptersExpanded && (
          <div className="border-t border-[var(--yn-border)] px-3.5 py-3">
            <ChaptersPanel
              key={videoContext?.videoId ?? 'no-video'}
              videoContext={videoContext}
              enabled
            />
          </div>
        )}
      </div>

      {!onPlaylistPage && !onWatchPage && (
        <p className="yn-popup-tagline mt-3 text-xs text-[var(--yn-muted)]">
          Open a playlist or video on YouTube to get started.
        </p>
      )}

      <footer className="yn-popup-credits mt-5 border-t border-[var(--yn-border)] pt-3 text-center text-xs text-[var(--yn-muted)]">
        Made by{' '}
        <a
          href={CREDITS_LINKEDIN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--yn-accent)] hover:underline"
        >
          Koushan De
        </a>
      </footer>
    </div>
  )
}
