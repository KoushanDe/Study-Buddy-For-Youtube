import { querySelectorAllDeep } from '../../shared/utils/shadow-dom'
import { extractJsonObject } from '../../shared/utils/json-extract'
import { parseCountFromText, readYouTubeText } from '../../shared/utils/youtube-text'

export interface PlaylistMetadata {
  title: string | null
  owner: string | null
  totalCount: number | null
  hiddenCount: number | null
}

function cleanText(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed.length > 0 ? trimmed : null
}

// New layout (yt-page-header-renderer) is preferred; legacy header kept as fallback.
const HEADER_SELECTORS = [
  'yt-page-header-renderer',
  'ytd-playlist-header-renderer',
  'ytd-browse[page-subtype="playlist"] #page-manager yt-page-header-renderer',
] as const

function getHeaderRoot(): Element | null {
  for (const selector of HEADER_SELECTORS) {
    const el = document.querySelector(selector)
    if (el) return el
  }
  for (const selector of HEADER_SELECTORS) {
    const el = querySelectorAllDeep(document, selector)[0]
    if (el) return el
  }
  return null
}

function titleFromDom(header: Element | null): string | null {
  if (!header) return null

  const candidates: (Element | null | undefined)[] = [
    header.querySelector('yt-dynamic-text-view-model h1'),
    header.querySelector('.page-header-view-model-wiz__page-header-title h1'),
    header.querySelector('h1.dynamicTextViewModelHost'),
    header.querySelector('h1 yt-formatted-string'),
    header.querySelector('h1'),
    querySelectorAllDeep(header, 'h1')[0],
  ]

  for (const el of candidates) {
    const text = cleanText(el?.textContent)
    if (text && text.length > 1) return text
  }

  return null
}

// document.title is layout-independent and updates on SPA navigation, so it is a
// strong fallback. Format: "(notifications) <Playlist Title> - YouTube".
function titleFromDocument(): string | null {
  let raw = document.title ?? ''
  raw = raw.replace(/^\(\d+\)\s*/, '')
  raw = raw.replace(/\s*-\s*YouTube\s*$/i, '')
  const cleaned = cleanText(raw)
  if (!cleaned || cleaned.length < 2) return null
  if (/^youtube$/i.test(cleaned)) return null
  return cleaned
}

function countFromDom(header: Element | null): number | null {
  const text = header?.textContent ?? ''
  const match = text.match(/([\d,]+)\s*videos?\b/i)
  if (!match) return null
  return parseCountFromText(match[0])
}

function ownerFromDom(header: Element | null): string | null {
  if (!header) return null

  const channelLinks = querySelectorAllDeep(
    header,
    'a[href^="/@"], a[href*="/channel/"], a[href*="youtube.com/@"]',
  )
  for (const link of channelLinks) {
    const text = cleanText(link.textContent)
    if (text && text.length > 1 && !/subscribe/i.test(text)) return text
  }

  const metaRows = querySelectorAllDeep(
    header,
    'yt-content-metadata-view-model, .yt-content-metadata-view-model, #metadata-row, ytd-channel-name',
  )
  for (const el of metaRows) {
    const text = cleanText(el.textContent)
    const byMatch = text?.match(/^by\s+(.+)$/i)
    if (byMatch?.[1]) return cleanText(byMatch[1])
    if (text && text.length > 1 && !/subscribe|\d+\s*videos?|views?|playlist/i.test(text)) {
      return text
    }
  }

  const headerText = header.textContent ?? ''
  const byMatch = headerText.match(/\bby\s+([^·\n]+?)(?:\s*·|\s*[\d,]+\s*videos?|\s*private|$)/i)
  if (byMatch?.[1]) return cleanText(byMatch[1])

  return null
}

function hiddenCountFromDom(): number | null {
  const roots: Element[] = []
  const browse = document.querySelector('ytd-browse[page-subtype="playlist"]')
  if (browse) roots.push(browse)
  const list = document.querySelector('ytd-playlist-video-list-renderer')
  if (list) roots.push(list)
  if (roots.length === 0) roots.push(document.body)

  for (const root of roots) {
    for (const el of querySelectorAllDeep(
      root,
      'yt-alert-with-button-renderer, ytd-message-renderer, ytd-playlist-message-renderer',
    )) {
      const match = (el.textContent ?? '').match(/(\d+)\s+unavailable videos? (?:is|are) hidden/i)
      if (match) return parseCountFromText(match[1])
    }
  }

  return null
}

function hiddenCountFromYtInitialData(raw: string): number | null {
  const textMatch = raw.match(
    /"numUnavailableVideos"\s*:\s*(?:\{\s*"simpleText"\s*:\s*"(\d+)"|(\d+))/,
  )
  if (textMatch) {
    return parseCountFromText(textMatch[1] ?? textMatch[2] ?? null)
  }

  const runsMatch = raw.match(
    /"numUnavailableVideos"\s*:\s*\{[^}]*"runs"\s*:\s*\[\s*\{\s*"text"\s*:\s*"(\d+)"/,
  )
  if (runsMatch) return parseCountFromText(runsMatch[1] ?? null)

  return null
}

let cachedRaw: string | null | undefined
let cachedParsed: Record<string, unknown> | null = null

// ytInitialData lives in a <script> tag written at first page load and is NOT
// rewritten on SPA navigation, so it can be stale. We parse it once and gate
// every read on the expected playlistId actually appearing in the raw text.
function getYtInitialData(): { parsed: Record<string, unknown> | null; raw: string | null } {
  if (cachedRaw !== undefined) return { parsed: cachedParsed, raw: cachedRaw }

  cachedRaw = null
  cachedParsed = null

  const scripts = document.querySelectorAll('script')
  for (const script of scripts) {
    const text = script.textContent ?? ''
    const marker = text.indexOf('ytInitialData')
    if (marker === -1) continue

    const braceStart = text.indexOf('{', marker)
    if (braceStart === -1) continue

    const jsonText = extractJsonObject(text, braceStart)
    if (!jsonText) continue

    try {
      cachedParsed = JSON.parse(jsonText) as Record<string, unknown>
      cachedRaw = jsonText
      break
    } catch {
      continue
    }
  }

  return { parsed: cachedParsed, raw: cachedRaw }
}

function metadataFromYtInitialData(expectedPlaylistId: string): PlaylistMetadata | null {
  const { parsed, raw } = getYtInitialData()
  if (!parsed || !raw) return null

  // Stale-data guard: trust the JSON only if it actually describes this playlist.
  if (!raw.includes(expectedPlaylistId)) return null

  const renderer = (parsed.metadata as Record<string, unknown> | undefined)
    ?.playlistMetadataRenderer as Record<string, unknown> | undefined

  const headerRenderer = (parsed.header as Record<string, unknown> | undefined)
    ?.playlistHeaderRenderer as Record<string, unknown> | undefined

  const source = renderer ?? headerRenderer
  if (!source) return null

  const title =
    readYouTubeText(source.title) ?? readYouTubeText(headerRenderer?.playlistTitle)

  const owner =
    readYouTubeText(source.ownerText) ??
    readYouTubeText(source.shortBylineText) ??
    readYouTubeText(headerRenderer?.ownerText) ??
    readYouTubeText(headerRenderer?.shortBylineText) ??
    (typeof source.channelName === 'string' ? source.channelName.trim() : null)

  const totalCount =
    parseCountFromText(readYouTubeText(source.numVideosText)) ??
    parseCountFromText(readYouTubeText(source.videoCountText)) ??
    parseCountFromText(readYouTubeText(headerRenderer?.numVideosText))

  const hiddenCount = hiddenCountFromYtInitialData(raw)

  return {
    title: cleanText(title),
    owner: cleanText(owner),
    totalCount,
    hiddenCount,
  }
}

export function getPlaylistMetadata(expectedPlaylistId: string): PlaylistMetadata {
  const header = getHeaderRoot()

  const domTitle = titleFromDom(header)
  const domOwner = ownerFromDom(header)
  const domCount = countFromDom(header)

  const docTitle = titleFromDocument()
  const domHidden = hiddenCountFromDom()
  const fromData = metadataFromYtInitialData(expectedPlaylistId)

  return {
    title: domTitle ?? docTitle ?? fromData?.title ?? null,
    owner: domOwner ?? fromData?.owner ?? null,
    totalCount: domCount ?? fromData?.totalCount ?? null,
    hiddenCount: domHidden ?? fromData?.hiddenCount ?? null,
  }
}
