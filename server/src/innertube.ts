const INNERTUBE_API_KEY = process.env.INNERTUBE_API_KEY ?? 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'
const INNERTUBE_CLIENT_VERSION = process.env.INNERTUBE_CLIENT_VERSION ?? '2.20250201.00.00'

export function innertubeHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Origin: 'https://www.youtube.com',
    Referer: 'https://www.youtube.com/',
    'X-Youtube-Client-Name': '1',
    'X-Youtube-Client-Version': INNERTUBE_CLIENT_VERSION,
  }
}

export function innertubeContext() {
  return {
    client: {
      clientName: 'WEB',
      clientVersion: INNERTUBE_CLIENT_VERSION,
      hl: 'en',
      gl: 'US',
    },
  }
}

export async function fetchPlayerResponse(videoId: string): Promise<Record<string, unknown>> {
  const fromPage = await fetchPlayerResponseFromWatchPage(videoId)
  if (fromPage) return fromPage

  const response = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}`, {
    method: 'POST',
    headers: innertubeHeaders(),
    body: JSON.stringify({
      videoId,
      context: innertubeContext(),
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to load player metadata (${response.status}): ${errorText.slice(0, 120)}`)
  }

  return (await response.json()) as Record<string, unknown>
}

export async function fetchPlayerResponseFromWatchPage(
  videoId: string,
): Promise<Record<string, unknown> | null> {
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': innertubeHeaders()['User-Agent'],
      'Accept-Language': 'en-US,en;q=0.9',
    },
  })

  if (!response.ok) return null

  const html = await response.text()
  const marker = 'ytInitialPlayerResponse = '
  const index = html.indexOf(marker)
  if (index === -1) return null

  const jsonText = extractJsonObject(html, index + marker.length)
  if (!jsonText) return null

  try {
    return JSON.parse(jsonText) as Record<string, unknown>
  } catch {
    return null
  }
}

function extractJsonObject(text: string, start: number): string | null {
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i += 1) {
    const char = text[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return text.slice(start, i + 1)
      }
    }
  }

  return null
}

interface CaptionTrack {
  baseUrl: string
  languageCode: string
}

export function extractCaptionTracks(playerResponse: Record<string, unknown>): CaptionTrack[] {
  const captions = playerResponse.captions as
    | {
        playerCaptionsTracklistRenderer?: {
          captionTracks?: Array<{ baseUrl?: string; languageCode?: string }>
        }
      }
    | undefined

  return (captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [])
    .filter((track) => track.baseUrl)
    .map((track) => ({
      baseUrl: track.baseUrl!,
      languageCode: track.languageCode ?? 'unknown',
    }))
}

export function selectCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (!tracks.length) return null
  return (
    tracks.find((track) => track.languageCode.startsWith('en')) ??
    tracks[0]
  )
}

export async function fetchCaptionSegments(
  track: CaptionTrack,
): Promise<Array<{ text: string; startMs: number; durationMs: number }>> {
  const url = new URL(track.baseUrl)
  if (!url.searchParams.has('fmt')) {
    url.searchParams.set('fmt', 'json3')
  }

  const response = await fetch(url.toString(), { headers: innertubeHeaders() })
  if (!response.ok) {
    throw new Error(`Failed to fetch captions (${response.status})`)
  }

  const raw = await response.text()
  if (raw.trim().startsWith('{')) {
    return parseJson3Captions(raw)
  }

  if (raw.trim().startsWith('<?xml') || raw.includes('<text')) {
    return parseXmlCaptions(raw)
  }

  throw new Error('Unsupported caption format from YouTube')
}

function parseJson3Captions(raw: string): Array<{ text: string; startMs: number; durationMs: number }> {
  const data = JSON.parse(raw) as {
    events?: Array<{
      tStartMs?: number
      dDurationMs?: number
      segs?: Array<{ utf8?: string }>
    }>
  }

  const segments: Array<{ text: string; startMs: number; durationMs: number }> = []
  for (const event of data.events ?? []) {
    const text = (event.segs ?? []).map((seg) => seg.utf8 ?? '').join('').trim()
    if (!text) continue
    segments.push({
      text,
      startMs: event.tStartMs ?? 0,
      durationMs: event.dDurationMs ?? 0,
    })
  }

  return segments
}

function parseXmlCaptions(raw: string): Array<{ text: string; startMs: number; durationMs: number }> {
  const segments: Array<{ text: string; startMs: number; durationMs: number }> = []
  const pattern = /<text start="([^"]+)" dur="([^"]+)"[^>]*>([^<]*)<\/text>/g

  for (const match of raw.matchAll(pattern)) {
    const text = match[3]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .trim()
    if (!text) continue

    segments.push({
      text,
      startMs: Math.round(Number(match[1]) * 1000),
      durationMs: Math.round(Number(match[2]) * 1000),
    })
  }

  return segments
}

export async function fetchTranscriptFromPlayer(videoId: string): Promise<{
  language: string
  segments: Array<{ text: string; startMs: number; durationMs: number }>
  text: string
}> {
  const player = await fetchPlayerResponse(videoId)
  const track = selectCaptionTrack(extractCaptionTracks(player))
  if (!track) {
    throw new Error('No captions available for this video')
  }

  const segments = await fetchCaptionSegments(track)
  if (!segments.length) {
    throw new Error('Caption track was empty')
  }

  return {
    language: track.languageCode,
    segments,
    text: segments.map((segment) => segment.text).join(' '),
  }
}
