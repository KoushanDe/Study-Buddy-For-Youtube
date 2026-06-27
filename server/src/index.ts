import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { generateChaptersWithGemini } from './gemini.js'
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

  const transcriptChars = body.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0)
  console.log(
    `[${timestamp()}] chapters request videoId=${body.videoId} chunks=${body.chunks.length} chars=${transcriptChars} duration=${body.durationSeconds}s`,
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
