import { BG, buildURL, getHeaders } from 'bgutils-js'
import { JSDOM } from 'jsdom'
import { Innertube } from 'youtubei.js'
import type { BgConfig } from 'bgutils-js'

export interface TranscriptSegment {
  text: string
  startMs: number
  durationMs: number
}

export interface TranscriptResult {
  language: string
  segments: TranscriptSegment[]
  text: string
}

// Lookup key that maps to YouTube's BotGuard program descriptor. Stable value
// published in the bgutils-js / youtubei.js PoToken examples.
const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo'

interface PoSession {
  innertube: Innertube
  minter: Awaited<ReturnType<typeof buildMinter>>
  visitorData: string
  createdAt: number
}

// PoTokens are short-lived; rebuild the session well before YouTube's TTL.
const SESSION_TTL_MS = 60 * 60 * 1000

let sessionPromise: Promise<PoSession> | null = null

/**
 * Fetches a video's transcript by downloading YouTube's caption track.
 *
 * YouTube gates the caption (`timedtext`) URLs behind a content-bound
 * Proof-of-Origin Token. We mint one with BotGuard (bgutils-js + jsdom) and
 * append it to the track URL. The InnerTube `get_transcript` endpoint is
 * deliberately avoided here because the current youtubei.js build returns a 400
 * for it.
 */
export async function fetchTranscriptViaInnertube(videoId: string): Promise<TranscriptResult> {
  try {
    return await fetchWithSession(videoId)
  } catch (error) {
    // Stale tokens surface as auth/400 errors; rebuild the session and retry once.
    sessionPromise = null
    if (isRetryableSessionError(error)) {
      return await fetchWithSession(videoId)
    }
    throw error
  }
}

async function fetchWithSession(videoId: string): Promise<TranscriptResult> {
  const session = await getSession()
  const info = await session.innertube.getInfo(videoId)

  const tracks = info.captions?.caption_tracks ?? []
  if (!tracks.length) {
    throw new Error('No captions available for this video')
  }

  const track = tracks.find((t) => t.language_code?.startsWith('en')) ?? tracks[0]
  const contentToken = await session.minter.mintAsWebsafeString(videoId)

  const url = new URL(track.base_url)
  url.searchParams.set('fmt', 'json3')
  url.searchParams.set('pot', contentToken)
  url.searchParams.set('c', 'WEB')

  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error(`Failed to fetch captions (${response.status})`)
  }

  const raw = await response.text()
  if (!raw.trim()) {
    throw new Error('Caption track was empty (token rejected)')
  }

  const segments = parseJson3Captions(raw)
  if (!segments.length) {
    throw new Error('Caption track contained no readable segments')
  }

  return {
    language: track.language_code ?? 'unknown',
    segments,
    text: segments.map((segment) => segment.text).join(' '),
  }
}

function getSession(): Promise<PoSession> {
  if (sessionPromise) {
    sessionPromise = sessionPromise
      .then((session) => (Date.now() - session.createdAt > SESSION_TTL_MS ? createSession() : session))
      .catch(() => createSession())
  } else {
    sessionPromise = createSession()
  }

  return sessionPromise.catch((error) => {
    sessionPromise = null
    throw error
  })
}

async function createSession(): Promise<PoSession> {
  // BotGuard's VM expects browser globals; jsdom supplies them.
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://www.youtube.com/',
  })
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
  })

  // Bootstrap an anonymous session to obtain visitor data, which tokens bind to.
  const bootstrap = await Innertube.create({ retrieve_player: false })
  const visitorData = bootstrap.session.context.client.visitorData
  if (!visitorData) {
    throw new Error('Could not obtain visitor data for PoToken')
  }

  const bgConfig: BgConfig = {
    fetch: (input, init) => fetch(input, init),
    globalObj: globalThis,
    identifier: visitorData,
    requestKey: REQUEST_KEY,
  }

  const minter = await buildMinter(bgConfig)
  const sessionToken = await minter.mintAsWebsafeString(visitorData)

  const innertube = await Innertube.create({
    lang: 'en',
    location: 'US',
    retrieve_player: true,
    po_token: sessionToken,
    visitor_data: visitorData,
  })

  return { innertube, minter, visitorData, createdAt: Date.now() }
}

/**
 * Runs the BotGuard challenge once and returns a minter capable of issuing both
 * session-bound (visitor data) and content-bound (video id) PoTokens.
 */
async function buildMinter(bgConfig: BgConfig) {
  const challenge = await BG.Challenge.create(bgConfig)
  if (!challenge) {
    throw new Error('Could not create BotGuard challenge')
  }

  const script = challenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue
  if (!script) {
    throw new Error('Could not load BotGuard interpreter')
  }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(script)()

  const botguard = await BG.BotGuardClient.create({
    program: challenge.program,
    globalName: challenge.globalName,
    globalObj: bgConfig.globalObj,
  })

  const webPoSignalOutput: unknown[] = []
  const botguardResponse = await botguard.snapshot({ webPoSignalOutput } as never)

  const integrityResponse = await bgConfig.fetch(buildURL('GenerateIT', bgConfig.useYouTubeAPI), {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify([bgConfig.requestKey, botguardResponse]),
  })
  const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] =
    (await integrityResponse.json()) as [string, number, number, string]

  return BG.WebPoMinter.create(
    { integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken },
    webPoSignalOutput as never,
  )
}

function parseJson3Captions(raw: string): TranscriptSegment[] {
  const data = JSON.parse(raw) as {
    events?: Array<{
      tStartMs?: number
      dDurationMs?: number
      segs?: Array<{ utf8?: string }>
    }>
  }

  const segments: TranscriptSegment[] = []
  for (const event of data.events ?? []) {
    const text = (event.segs ?? [])
      .map((seg) => seg.utf8 ?? '')
      .join('')
      .trim()
    if (!text) continue
    segments.push({
      text,
      startMs: event.tStartMs ?? 0,
      durationMs: event.dDurationMs ?? 0,
    })
  }

  return segments
}

function isRetryableSessionError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return (
    message.includes('token rejected') ||
    message.includes('empty') ||
    message.includes('400') ||
    message.includes('401') ||
    message.includes('403')
  )
}
