import { parseEmbeddedJson } from '../../shared/utils/json-extract'
import { parseYtInitialPlayerResponse } from '../transcript/player-response-bridge'
import { getVideoId } from '../../shared/utils/youtube-url'
import type { Chapter } from '../../shared/types/chapter'

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? (value as UnknownRecord) : null
}

function readText(value: unknown): string {
  const record = asRecord(value)
  if (!record) return ''
  if (typeof record.simpleText === 'string') return record.simpleText
  if (Array.isArray(record.runs)) {
    return record.runs
      .map((run) => asRecord(run)?.text)
      .filter((text): text is string => typeof text === 'string')
      .join('')
  }
  return ''
}

function finalizeChapters(chapters: Chapter[]): Chapter[] | null {
  if (chapters.length < 2) return null

  const sorted = [...chapters].sort((a, b) => a.startSeconds - b.startSeconds)
  const unique: Chapter[] = []
  for (const chapter of sorted) {
    if (unique.some((item) => item.startSeconds === chapter.startSeconds)) continue
    unique.push(chapter)
  }

  return unique.length >= 2 ? unique : null
}

function parseChapterList(chapters: unknown): Chapter[] | null {
  if (!Array.isArray(chapters) || chapters.length === 0) return null

  const parsed = chapters
    .map((item) => {
      const renderer = asRecord(asRecord(item)?.chapterRenderer)
      if (!renderer) return null

      const title = readText(renderer.title)
      const startMs = Number(renderer.timeRangeStartMillis ?? renderer.startMillis ?? 0)
      if (!title) return null

      return {
        title,
        startSeconds: Math.max(0, Math.floor(startMs / 1000)),
      }
    })
    .filter((chapter): chapter is Chapter => chapter !== null)

  return finalizeChapters(parsed)
}

function extractFromMarkersMap(data: UnknownRecord): Chapter[] | null {
  const overlays = asRecord(asRecord(data.playerOverlays)?.playerOverlayRenderer)
  const decorated = asRecord(overlays?.decoratedPlayerBarRenderer)
  const innerDecorated = asRecord(decorated?.decoratedPlayerBarRenderer)
  const playerBar = asRecord(innerDecorated?.playerBar)
  const markers = asRecord(playerBar?.multiMarkersPlayerBarRenderer)
  const markersMap = markers?.markersMap

  if (!Array.isArray(markersMap)) return null

  for (const marker of markersMap) {
    const entry = asRecord(marker)
    const chapters = parseChapterList(asRecord(entry?.value)?.chapters)
    if (chapters) return chapters
  }

  return null
}

function extractFromEngagementPanels(data: UnknownRecord): Chapter[] | null {
  const panels = data.engagementPanels
  if (!Array.isArray(panels)) return null

  for (const panel of panels) {
    const renderer = asRecord(asRecord(panel)?.engagementPanelSectionListRenderer)
    const content = asRecord(renderer?.content)
    const macroMarkers = asRecord(content?.macroMarkersListRenderer)
    const items = macroMarkers?.contents

    if (!Array.isArray(items)) continue

    const chapters: Chapter[] = []
    for (const item of items) {
      const macro = asRecord(asRecord(item)?.macroMarkersListItemRenderer)
      if (!macro) continue

      const title = readText(macro.title)
      const startMs = Number(macro.timeRangeStartMillis ?? macro.startMillis ?? 0)
      if (!title) continue

      chapters.push({
        title,
        startSeconds: Math.max(0, Math.floor(startMs / 1000)),
      })
    }

    const parsed = finalizeChapters(chapters)
    if (parsed) return parsed
  }

  return null
}

function extractFromYtInitialDataDom(): Chapter[] | null {
  const descriptionItems = document.querySelectorAll(
    'ytd-macro-markers-list-item-renderer, ytd-macro-markers-list-renderer #contents > *',
  )

  if (descriptionItems.length < 2) return null

  const chapters: Chapter[] = []
  descriptionItems.forEach((el) => {
    const title = el.querySelector('#title, .macro-markers .macro-markers-title')?.textContent?.trim()
    const timeText = el.querySelector('#time, .macro-markers-time')?.textContent?.trim() ?? '0:00'
    if (!title) return

    const parts = timeText.split(':').map(Number)
    let startSeconds = 0
    if (parts.length === 3) {
      startSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
    } else if (parts.length === 2) {
      startSeconds = parts[0] * 60 + parts[1]
    }

    chapters.push({ title, startSeconds })
  })

  return finalizeChapters(chapters)
}

function extractFromEmbeddedData(data: UnknownRecord): Chapter[] | null {
  return extractFromMarkersMap(data) ?? extractFromEngagementPanels(data)
}

// YouTube does NOT refresh the embedded `ytInitialData` / `ytInitialPlayerResponse`
// script tags on SPA navigation, so they can describe a previously watched video.
// Reading the source's own videoId lets us reject stale data instead of returning
// (and caching) the wrong video's chapters.
function readDataVideoId(data: UnknownRecord): string | null {
  const fromPlayer = asRecord(data.videoDetails)?.videoId
  if (typeof fromPlayer === 'string' && fromPlayer) return fromPlayer

  const endpoint = asRecord(asRecord(data.currentVideoEndpoint)?.watchEndpoint)?.videoId
  if (typeof endpoint === 'string' && endpoint) return endpoint

  return null
}

export function extractNativeYouTubeChapters(): Chapter[] | null {
  const currentVideoId = getVideoId()
  const sources: UnknownRecord[] = []

  const playerResponse = parseYtInitialPlayerResponse()
  if (playerResponse) sources.push(playerResponse)

  const initialData = parseEmbeddedJson('ytInitialData = ')
  if (initialData) sources.push(initialData)

  for (const data of sources) {
    // Only trust an embedded source when it is for the video we are actually on.
    if (currentVideoId) {
      const dataVideoId = readDataVideoId(data)
      if (dataVideoId && dataVideoId !== currentVideoId) continue
    }

    const chapters = extractFromEmbeddedData(data)
    if (chapters) return chapters
  }

  // The rendered DOM always reflects the current video, so it is a safe fallback
  // when both embedded payloads are stale after an in-app navigation.
  return extractFromYtInitialDataDom()
}
