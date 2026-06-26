import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { generateChaptersWithGemini } from './gemini.js'
import { fetchTranscriptFromPlayer } from './innertube.js'
import { fetchTranscriptViaInnertube } from './youtube-transcript.js'
import type { Context } from 'hono'
import type { ChapterRequest } from './types.js'

const app = new Hono()
const PORT = Number(process.env.PORT ?? 3001)
const EXTENSION_API_TOKEN = process.env.EXTENSION_API_TOKEN ?? ''
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 20

const requestLog = new Map<string, number[]>()

app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
)

app.use('*', async (c, next) => {
  const started = Date.now()
  const method = c.req.method
  const path = c.req.path

  if (method !== 'OPTIONS') {
    console.log(`[${timestamp()}] --> ${method} ${path}`)
  }

  await next()

  if (method !== 'OPTIONS') {
    const ms = Date.now() - started
    console.log(`[${timestamp()}] <-- ${method} ${path} ${c.res.status} (${ms}ms)`)
  }
})

app.get('/health', (c) => c.json({ ok: true }))

app.post('/api/chapters', async (c) => {
  const clientIp = getClientIp(c)
  const unauthorized = authorizeRequest(c)
  if (unauthorized) return unauthorized

  if (!checkRateLimit(requestLog, clientIp, RATE_LIMIT_MAX)) {
    return c.json({ error: 'Rate limit exceeded. Try again shortly.' }, 429)
  }

  let body: ChapterRequest
  try {
    body = await c.req.json<ChapterRequest>()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (!body.videoId || !body.title || !Array.isArray(body.chunks) || body.chunks.length === 0) {
    return c.json({ error: 'videoId, title, and chunks are required' }, 400)
  }

  console.log(
    `[${timestamp()}] chapters request videoId=${body.videoId} chunks=${body.chunks.length} duration=${body.durationSeconds ?? '?'}s`,
  )

  try {
    const chapters = await generateChaptersWithGemini(body)
    console.log(`[${timestamp()}] chapters ok videoId=${body.videoId} count=${chapters.length}`)
    return c.json({ chapters })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Chapter generation failed'
    console.error(`[${timestamp()}] chapters failed videoId=${body.videoId}: ${message}`)
    return c.json({ error: message }, 500)
  }
})

app.post('/api/transcript', async (c) => {
  const clientIp = getClientIp(c)
  const unauthorized = authorizeRequest(c)
  if (unauthorized) return unauthorized

  if (!checkRateLimit(requestLog, clientIp, RATE_LIMIT_MAX)) {
    return c.json({ error: 'Rate limit exceeded. Try again shortly.' }, 429)
  }

  let body: { videoId?: string }
  try {
    body = await c.req.json<{ videoId?: string }>()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (!body.videoId) {
    return c.json({ error: 'videoId is required' }, 400)
  }

  console.log(`[${timestamp()}] transcript request videoId=${body.videoId}`)

  try {
    const transcript = await fetchTranscriptForVideo(body.videoId)
    console.log(
      `[${timestamp()}] transcript ok videoId=${body.videoId} segments=${transcript.segments.length} lang=${transcript.language}`,
    )
    return c.json({
      videoId: body.videoId,
      language: transcript.language,
      segments: transcript.segments,
      text: transcript.text,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Transcript fetch failed'
    console.error(`[${timestamp()}] transcript failed videoId=${body.videoId}: ${message}`)
    return c.json({ error: message }, 500)
  }
})

/**
 * Resolves a transcript using youtubei.js (InnerTube get_transcript) first, since
 * it is the most reliable from a residential IP. Falls back to the legacy
 * caption-track scraper only if the library path fails.
 */
async function fetchTranscriptForVideo(videoId: string) {
  try {
    return await fetchTranscriptViaInnertube(videoId)
  } catch (primaryError) {
    const message = primaryError instanceof Error ? primaryError.message : String(primaryError)
    console.warn(`[${timestamp()}] innertube transcript failed videoId=${videoId}: ${message}`)
    return await fetchTranscriptFromPlayer(videoId)
  }
}

function authorizeRequest(c: Context) {
  if (!EXTENSION_API_TOKEN) return null

  const auth = c.req.header('Authorization')
  if (auth !== `Bearer ${EXTENSION_API_TOKEN}`) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  return null
}

function getClientIp(c: Context): string {
  return c.req.header('x-forwarded-for') ?? c.req.header('cf-connecting-ip') ?? 'unknown'
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 23)
}

function checkRateLimit(
  store: Map<string, number[]>,
  clientId: string,
  maxRequests: number,
): boolean {
  const now = Date.now()
  const timestamps = (store.get(clientId) ?? []).filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS)
  if (timestamps.length >= maxRequests) {
    store.set(clientId, timestamps)
    return false
  }
  timestamps.push(now)
  store.set(clientId, timestamps)
  return true
}

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Study Buddy for YouTube API running on http://localhost:${PORT}`)
})
