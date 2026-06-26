import { PLAYLIST_CONTAINER_SELECTORS } from '../../shared/constants'
import { ynLog } from '../../shared/utils/debug-log'
import { querySelectorAllDeep } from '../../shared/utils/shadow-dom'
import { parseDurationToSeconds } from './duration-parser'

export type { PlaylistMetadata } from './playlist-metadata'
export { getPlaylistMetadata } from './playlist-metadata'

export interface ScrapedVideo {
  videoId: string
  durationSeconds: number
}

const DURATION_SELECTORS = [
  'ytd-thumbnail-overlay-time-status-renderer span',
  'ytd-thumbnail-overlay-time-status-renderer',
  '.badge-shape-wiz__text',
  '[class*="time-status"] span',
  'span#text',
] as const

const TIME_TEXT_PATTERN = /^\d{1,2}:\d{2}(:\d{2})?$/

const PLAYLIST_ITEM_SELECTOR =
  'ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, ytd-grid-video-renderer, yt-lockup-view-model'

export function getPlaylistItems(): Element[] {
  const container = findPlaylistContainer()
  const root: ParentNode = container ?? document

  try {
    const direct = root.querySelectorAll(PLAYLIST_ITEM_SELECTOR)
    if (direct.length > 0) return Array.from(direct)
  } catch {
    // fall through to deep query
  }

  const deep = querySelectorAllDeep(root as Element, PLAYLIST_ITEM_SELECTOR)
  ynLog('playlist', 'using deep playlist item query', { count: deep.length })
  return deep
}

export function findPlaylistContainer(): Element | null {
  for (const selector of PLAYLIST_CONTAINER_SELECTORS) {
    const container = document.querySelector(selector)
    if (!container) continue
    if (container.querySelector(PLAYLIST_ITEM_SELECTOR)) {
      ynLog('playlist', `container found via ${selector}`)
      return container
    }
  }

  const items = getPlaylistItems()
  if (items.length > 0) {
    ynLog('playlist', 'container inferred from playlist items parent', { itemCount: items.length })
    return items[0]?.parentElement ?? null
  }

  ynLog('playlist', 'no playlist container found')
  return null
}

export function extractVideoIdFromItem(item: Element): string | null {
  const links = querySelectorAllDeep(item, 'a[href*="watch"], a[href*="v="]')
  for (const link of links) {
    if (!(link instanceof HTMLAnchorElement) || !link.href) continue
    try {
      const url = new URL(link.href, location.origin)
      const videoId = url.searchParams.get('v')
      if (videoId && videoId.length === 11) return videoId
    } catch {
      continue
    }
  }

  const htmlMatch = item.innerHTML.match(/[?&]v=([a-zA-Z0-9_-]{11})/)
  return htmlMatch?.[1] ?? null
}

function parseDurationFromAriaLabel(label: string): number | null {
  const match = label.match(
    /(\d+)\s*(?:hour|hr|h)\s*(?:(\d+)\s*(?:minute|min|m))?|(\d+)\s*(?:minute|min|m)\s*(?:(\d+)\s*(?:second|sec|s))?/i,
  )
  if (!match) return null

  const hours = Number(match[1] ?? 0)
  const minutes = Number(match[2] ?? match[3] ?? 0)
  const seconds = Number(match[4] ?? 0)
  return hours * 3600 + minutes * 60 + seconds
}

function parseDurationFromLabel(label: string): number | null {
  const timeMatch = label.match(/(\d{1,2}:)?\d{1,2}:\d{2}(?!\d)/)
  if (timeMatch) {
    const parsed = parseDurationToSeconds(timeMatch[0])
    if (parsed !== null) return parsed
  }
  return parseDurationFromAriaLabel(label)
}

export function extractDurationFromItem(item: Element): number | null {
  for (const selector of DURATION_SELECTORS) {
    for (const element of querySelectorAllDeep(item, selector)) {
      const parsed = parseDurationToSeconds(element.textContent ?? '')
      if (parsed !== null) return parsed
    }
  }

  for (const element of querySelectorAllDeep(item, '[aria-label]')) {
    const label = element.getAttribute('aria-label')
    if (!label) continue
    const parsed = parseDurationFromLabel(label)
    if (parsed !== null) return parsed
  }

  for (const element of querySelectorAllDeep(item, 'span, div')) {
    const text = (element.textContent ?? '').trim()
    if (text.length > 8 || !TIME_TEXT_PATTERN.test(text)) continue

    const childText = Array.from(element.children)
      .map((child) => (child.textContent ?? '').trim())
      .join('')
    if (childText && childText !== text) continue

    const parsed = parseDurationToSeconds(text)
    if (parsed !== null) return parsed
  }

  return null
}

export function scrapeVisiblePlaylistVideos(): ScrapedVideo[] {
  const items = getPlaylistItems()
  const videos: ScrapedVideo[] = []

  items.forEach((item) => {
    const videoId = extractVideoIdFromItem(item)
    const durationSeconds = extractDurationFromItem(item)
    if (!videoId || durationSeconds === null) return
    videos.push({ videoId, durationSeconds })
  })

  return videos
}

export function getPlaylistScrollContainer(): HTMLElement | null {
  const list = findPlaylistContainer()
  if (!list) return null

  let parent: HTMLElement | null = list.parentElement
  while (parent) {
    const style = getComputedStyle(parent)
    if (/(auto|scroll)/.test(style.overflowY)) {
      return parent
    }
    parent = parent.parentElement
  }

  return document.scrollingElement as HTMLElement | null
}

export function isPlaylistScrollAtBottom(container: HTMLElement | null): boolean {
  if (!container) return false
  const threshold = 80
  return container.scrollTop + container.clientHeight >= container.scrollHeight - threshold
}
