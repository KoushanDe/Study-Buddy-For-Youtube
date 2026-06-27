import { BG, buildURL, getHeaders } from 'bgutils-js'
import { Innertube } from 'youtubei.js'
import type { BgConfig } from 'bgutils-js'
import { parseJson3Captions } from '../../shared/utils/parse-json3-captions'
import type { TranscriptResult, TranscriptSegment } from '../../shared/types/transcript'

const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo'
const SESSION_TTL_MS = 60 * 60 * 1000
const BOTGUARD_SNAPSHOT_TIMEOUT_MS = 30_000
const BOTGUARD_MAX_ATTEMPTS = 3

interface PoSession {
  innertube: Innertube
  minter: Awaited<ReturnType<typeof buildMinter>>
  createdAt: number
}

interface CaptionTrackRef {
  baseUrl: string
  languageCode: string
}

type BotGuardChallenge = NonNullable<Awaited<ReturnType<typeof BG.Challenge.create>>>

let sessionPromise: Promise<PoSession> | null = null
let cachedInterpreterHash: string | undefined
let boundFetch: typeof fetch = (input, init) => globalThis.fetch(input, init)

export function bindTranscriptFetch(fetchImpl: typeof fetch): void {
  boundFetch = fetchImpl
}

export async function fetchTranscriptViaInnertube(videoId: string): Promise<TranscriptResult> {
  try {
    const fromPlayer = await tryFetchFromPlayerResponse(videoId)
    if (fromPlayer) return fromPlayer

    return await fetchWithSession(videoId)
  } catch (error) {
    sessionPromise = null
    if (isRetryableSessionError(error)) {
      try {
        const fromPlayer = await tryFetchFromPlayerResponse(videoId)
        if (fromPlayer) return fromPlayer
        return await fetchWithSession(videoId)
      } catch (retryError) {
        throw normalizeTranscriptError(retryError)
      }
    }
    throw normalizeTranscriptError(error)
  }
}

async function fetchWithSession(videoId: string): Promise<TranscriptResult> {
  const session = await getSession()

  const fromTranscriptApi = await tryFetchViaTranscriptApi(session.innertube, videoId)
  if (fromTranscriptApi) return fromTranscriptApi

  const info = await session.innertube.getInfo(videoId)
  const tracks = info.captions?.caption_tracks ?? []
  if (!tracks.length) {
    throw new Error('No captions available for this video')
  }

  const track = tracks.find((t) => t.language_code?.startsWith('en')) ?? tracks[0]
  const contentToken = await session.minter.mintAsWebsafeString(videoId)
  const segments = await fetchCaptionTrack(track.base_url, contentToken)
  if (!segments) {
    throw new Error('Caption track was empty (token rejected)')
  }
  return toTranscriptResult(videoId, track.language_code ?? 'unknown', segments)
}

async function tryFetchFromPlayerResponse(videoId: string): Promise<TranscriptResult | null> {
  const tracks = getCaptionTracksFromPlayerResponse(videoId)
  if (!tracks.length) return null

  const track = tracks.find((t) => t.languageCode.startsWith('en')) ?? tracks[0]

  const existingPot = new URL(track.baseUrl).searchParams.get('pot')
  if (existingPot) {
    const segments = await fetchCaptionTrack(track.baseUrl, existingPot)
    if (segments) return toTranscriptResult(videoId, track.languageCode, segments)
  }

  const segments = await fetchCaptionTrack(track.baseUrl)
  if (segments) return toTranscriptResult(videoId, track.languageCode, segments)

  try {
    const session = await getSession()
    const contentToken = await session.minter.mintAsWebsafeString(videoId)
    const mintedSegments = await fetchCaptionTrack(track.baseUrl, contentToken)
    if (mintedSegments) return toTranscriptResult(videoId, track.languageCode, mintedSegments)
  } catch {
    // Fall through to the full Innertube session path.
  }

  return null
}

async function tryFetchViaTranscriptApi(
  innertube: Innertube,
  videoId: string,
): Promise<TranscriptResult | null> {
  try {
    const info = await innertube.getInfo(videoId)
    const transcriptInfo = await info.getTranscript()
    const initialSegments =
      transcriptInfo.transcript?.content?.body?.initial_segments ?? []

    const segments: TranscriptSegment[] = []
    for (const segment of initialSegments) {
      if (segment.type !== 'TranscriptSegment') continue
      const text = segment.snippet?.toString?.().trim() ?? ''
      if (!text) continue
      segments.push({
        text,
        startMs: Number(segment.start_ms ?? 0),
        durationMs: Math.max(0, Number(segment.end_ms ?? 0) - Number(segment.start_ms ?? 0)),
      })
    }

    if (!segments.length) return null

    const language = transcriptInfo.selectedLanguage || 'unknown'
    return toTranscriptResult(videoId, language, segments)
  } catch {
    return null
  }
}

function getCaptionTracksFromPlayerResponse(videoId: string): CaptionTrackRef[] {
  const playerResponse = (
    globalThis as unknown as { ytInitialPlayerResponse?: Record<string, unknown> }
  ).ytInitialPlayerResponse
  if (!playerResponse) return []

  const playerVideoId = (playerResponse.videoDetails as { videoId?: string } | undefined)?.videoId
  if (playerVideoId && playerVideoId !== videoId) return []

  const renderer = playerResponse.captions as
    | { playerCaptionsTracklistRenderer?: { captionTracks?: Array<{ baseUrl?: string; languageCode?: string }> } }
    | undefined
  const tracks = renderer?.playerCaptionsTracklistRenderer?.captionTracks
  if (!Array.isArray(tracks)) return []

  return tracks
    .filter((track): track is { baseUrl: string; languageCode: string } => {
      return typeof track.baseUrl === 'string' && typeof track.languageCode === 'string'
    })
    .map((track) => ({
      baseUrl: track.baseUrl,
      languageCode: track.languageCode,
    }))
}

async function fetchCaptionTrack(
  baseUrl: string,
  contentToken?: string,
): Promise<TranscriptSegment[] | null> {
  const url = new URL(baseUrl)
  url.searchParams.set('fmt', 'json3')
  url.searchParams.set('c', 'WEB')
  if (contentToken) {
    url.searchParams.set('pot', contentToken)
  }

  const response = await boundFetch(url.toString())
  if (!response.ok) return null

  const raw = await response.text()
  if (!raw.trim()) return null

  const segments = parseJson3Captions(raw)
  return segments.length ? segments : null
}

function toTranscriptResult(
  videoId: string,
  language: string,
  segments: TranscriptSegment[],
): TranscriptResult {
  return {
    videoId,
    language,
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
  const bootstrap = await Innertube.create({ retrieve_player: false, fetch: boundFetch })
  const visitorData = bootstrap.session.context.client.visitorData
  if (!visitorData) {
    throw new Error('Could not obtain visitor data for PoToken')
  }

  const bgConfig: BgConfig = {
    fetch: boundFetch,
    globalObj: globalThis,
    identifier: visitorData,
    requestKey: REQUEST_KEY,
    useYouTubeAPI: true,
  }

  const minter = await buildMinter(bgConfig)
  const sessionToken = await minter.mintAsWebsafeString(visitorData)

  const innertube = await Innertube.create({
    lang: 'en',
    location: 'US',
    retrieve_player: true,
    po_token: sessionToken,
    visitor_data: visitorData,
    fetch: boundFetch,
  })

  return { innertube, minter, createdAt: Date.now() }
}

async function buildMinter(bgConfig: BgConfig) {
  let lastError: unknown

  for (let attempt = 1; attempt <= BOTGUARD_MAX_ATTEMPTS; attempt++) {
    try {
      return await buildMinterOnce(bgConfig)
    } catch (error) {
      lastError = error
      if (!isBotGuardRetryable(error) || attempt === BOTGUARD_MAX_ATTEMPTS) {
        throw error
      }
      cachedInterpreterHash = undefined
      await sleep(400 * attempt)
    }
  }

  throw lastError
}

async function buildMinterOnce(bgConfig: BgConfig) {
  const challenge = await BG.Challenge.create(bgConfig, cachedInterpreterHash)
  if (!challenge) {
    throw new Error('Could not create BotGuard challenge')
  }

  if (challenge.interpreterHash) {
    cachedInterpreterHash = challenge.interpreterHash
  }

  await installBotGuardVm(challenge)
  await sleep(100)

  const botguard = await BG.BotGuardClient.create({
    program: challenge.program,
    globalName: challenge.globalName,
    globalObj: bgConfig.globalObj,
    userInteractionElement: getUserInteractionElement(),
  })

  const webPoSignalOutput: never[] = []
  const botguardResponse = await botguard.snapshot(
    { webPoSignalOutput },
    BOTGUARD_SNAPSHOT_TIMEOUT_MS,
  )

  if (!webPoSignalOutput[0]) {
    throw new Error('PMD:Undefined')
  }

  const integrityResponse = await bgConfig.fetch(buildURL('GenerateIT', bgConfig.useYouTubeAPI), {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify([bgConfig.requestKey, botguardResponse]),
  })

  if (!integrityResponse.ok) {
    throw new Error(`BotGuard integrity request failed (${integrityResponse.status})`)
  }

  const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] =
    (await integrityResponse.json()) as [string, number, number, string]

  return BG.WebPoMinter.create(
    { integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken },
    webPoSignalOutput as never,
  )
}

function getUserInteractionElement(): HTMLElement {
  return (
    document.querySelector('#movie_player') ??
    document.querySelector('video.html5-main-video') ??
    document.querySelector('video') ??
    document.body
  )
}

async function installBotGuardVm(challenge: BotGuardChallenge): Promise<void> {
  const globals = globalThis as Record<string, unknown>
  if (globals[challenge.globalName]) return

  const scriptId = challenge.interpreterHash
  if (scriptId && document.getElementById(scriptId) && globals[challenge.globalName]) {
    return
  }

  const trustedUrl =
    challenge.interpreterJavascript.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue
  if (trustedUrl) {
    await injectExternalScript(`https:${trustedUrl}`, scriptId ?? undefined)
    if (!globals[challenge.globalName]) {
      throw new Error('BotGuard VM not found after loading interpreter URL')
    }
    return
  }

  const inline = challenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue
  if (!inline) {
    throw new Error('Could not load BotGuard interpreter')
  }

  if (!scriptId || !document.getElementById(scriptId)) {
    const script = document.createElement('script')
    script.type = 'text/javascript'
    if (scriptId) script.id = scriptId
    script.textContent = inline
    document.head.appendChild(script)
  }

  if (!globals[challenge.globalName]) {
    throw new Error('BotGuard VM not found after loading interpreter')
  }
}

function injectExternalScript(src: string, id?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (id && document.getElementById(id)) {
      resolve()
      return
    }

    const script = document.createElement('script')
    script.type = 'text/javascript'
    if (id) script.id = id
    script.src = src
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load BotGuard interpreter URL'))
    document.head.appendChild(script)
  })
}

function isBotGuardRetryable(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return (
    message.includes('pmd:undefined') ||
    message.includes('apf:failed') ||
    message.includes('botguard') ||
    message.includes('integrity request failed') ||
    message.includes('vm not found') ||
    message.includes('timed out')
  )
}

function isRetryableSessionError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return (
    isBotGuardRetryable(error) ||
    message.includes('token rejected') ||
    message.includes('empty') ||
    message.includes('illegal invocation') ||
    message.includes('400') ||
    message.includes('401') ||
    message.includes('403')
  )
}

function normalizeTranscriptError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (message.toLowerCase().includes('pmd:undefined')) {
    return new Error(
      'YouTube blocked transcript access for this video. Play the video for a few seconds, refresh the page, then try again.',
    )
  }
  return error instanceof Error ? error : new Error(message)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
