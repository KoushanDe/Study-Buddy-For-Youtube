import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { generateChaptersWithGemini } from './gemini.js'
import { runMigrations } from './db/migrate.js'
import { closePool } from './db/pool.js'
import { getReadyVideoChapters, generateWithGlobalLock } from './db/video-chapters.js'
import { getUserVideoChapters } from './db/user-video-chapters.js'
import {
  handleRegenerate,
  handleRegenerateFeedback,
  getRegenerateQuotaForClient,
  type RegenerateSuccess,
} from './regenerate.js'
import type { Context } from 'hono'
import type { ChapterRequest, RegenerateFeedbackRequest, RegenerateRequest } from './types.js'

const app = new Hono()
const PORT = Number(process.env.PORT ?? 3001)
const EXTENSION_API_TOKEN = process.env.EXTENSION_API_TOKEN ?? ''

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
  const unauthorized = authorizeRequest(c)
  if (unauthorized) return unauthorized

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
    if (body.clientId) {
      const userChapters = await getUserVideoChapters(body.clientId, body.videoId)
      if (userChapters?.length) {
        console.log(
          `[${timestamp()}] chapters user cache hit videoId=${body.videoId} clientId=${body.clientId.slice(0, 8)}… count=${userChapters.length}`,
        )
        return c.json({ chapters: userChapters, source: 'user_db' })
      }
    }

    const cached = await getReadyVideoChapters(body.videoId)
    if (cached?.length) {
      console.log(`[${timestamp()}] chapters cache hit videoId=${body.videoId} count=${cached.length}`)
      return c.json({ chapters: cached, source: 'db' })
    }

    const chapters = await generateWithGlobalLock(
      body.videoId,
      body.title,
      body.durationSeconds,
      () => generateChaptersWithGemini(body),
    )
    console.log(`[${timestamp()}] chapters ok videoId=${body.videoId} count=${chapters.length}`)

    return c.json({ chapters, source: 'generated' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Chapter generation failed'
    console.error(`[${timestamp()}] chapters failed videoId=${body.videoId}: ${message}`)
    return c.json({ error: message }, 500)
  }
})

app.get('/api/regenerate/quota', async (c) => {
  const unauthorized = authorizeRequest(c)
  if (unauthorized) return unauthorized

  const clientId = c.req.query('clientId')
  const videoId = c.req.query('videoId') ?? undefined

  if (!clientId) {
    return c.json({ error: 'clientId is required' }, 400)
  }

  try {
    const quota = await getRegenerateQuotaForClient(clientId, videoId)
    return c.json(quota)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load quota'
    return c.json({ error: message }, 500)
  }
})

app.post('/api/regenerate', async (c) => {
  const unauthorized = authorizeRequest(c)
  if (unauthorized) return unauthorized

  let body: RegenerateRequest
  try {
    body = await c.req.json<RegenerateRequest>()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (!body.videoId || !body.title || !Array.isArray(body.chunks) || body.chunks.length === 0) {
    return c.json({ error: 'videoId, title, and chunks are required' }, 400)
  }

  if (!body.clientId) {
    return c.json({ error: 'clientId is required' }, 400)
  }

  console.log(
    `[${timestamp()}] regenerate request videoId=${body.videoId} clientId=${body.clientId.slice(0, 8)}…`,
  )

  try {
    const result = await handleRegenerate(body)

    if ('error' in result && !('denied' in result) && !('quotaExhausted' in result) && !('cooldown' in result)) {
      return c.json({ error: result.error }, 400)
    }
    if ('denied' in result && result.denied) {
      return c.json({ error: result.error, denied: true }, 403)
    }
    if ('quotaExhausted' in result && result.quotaExhausted) {
      return c.json(
        {
          error: result.error,
          quotaExhausted: true,
          resetsAt: 'resetsAt' in result ? result.resetsAt : undefined,
        },
        429,
      )
    }
    if ('cooldown' in result && result.cooldown) {
      return c.json({ error: result.error, cooldown: result.cooldown }, 403)
    }

    const success = result as RegenerateSuccess
    console.log(
      `[${timestamp()}] regenerate ok videoId=${body.videoId} stagingId=${success.stagingId} type=${success.reasonType}`,
    )
    return c.json({
      chapters: success.chapters,
      stagingId: success.stagingId,
      reasonType: success.reasonType,
      source: 'regenerated',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Regeneration failed'
    console.error(`[${timestamp()}] regenerate failed videoId=${body.videoId}: ${message}`)
    return c.json({ error: message }, 500)
  }
})

app.post('/api/regenerate/feedback', async (c) => {
  const unauthorized = authorizeRequest(c)
  if (unauthorized) return unauthorized

  let body: RegenerateFeedbackRequest
  try {
    body = await c.req.json<RegenerateFeedbackRequest>()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  try {
    const result = await handleRegenerateFeedback(body)
    if ('error' in result) {
      return c.json({ error: result.error }, 400)
    }
    return c.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Feedback failed'
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

function timestamp(): string {
  return new Date().toISOString().slice(11, 23)
}

async function start(): Promise<void> {
  await runMigrations()
  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`Study Buddy for YouTube API running on http://localhost:${PORT}`)
  })
}

async function shutdown(): Promise<void> {
  await closePool()
}

process.on('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0))
})
process.on('SIGINT', () => {
  void shutdown().finally(() => process.exit(0))
})

void start().catch((error) => {
  console.error('Failed to start server:', error)
  process.exit(1)
})
