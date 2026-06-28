import type { Chapter, ChapterRequest } from './types.js'
import { getChapterGuidance, formatTimestamp, type ChapterGuidance } from './chapter-guidance.js'
import { validateChapters } from './validate-chapters.js'

interface Boundary {
  startSeconds: number
  topicSummary: string
}

const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
const GEMINI_REQUEST_TIMEOUT_MS = 180_000

/**
 * Two-pass chapter generation.
 *
 * Pass 1 maximizes recall of real section boundaries (where does the topic
 * change?). Pass 2 turns those boundaries into polished titles and merges
 * over-granular splits / splits missed ones (what should we call each section?).
 * Separating the two stops single-topic videos from collapsing into one chapter
 * while also avoiding micro-chapter spam. See
 * .cursor/rules/chapter-generation.mdc for the design rationale.
 */
export async function generateChaptersWithGemini(input: ChapterRequest): Promise<Chapter[]> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server')
  }

  const guidance = getChapterGuidance(input.durationSeconds, input.chunks.length)
  const chunkText = buildChunkText(input)

  const boundaries = await detectBoundaries(apiKey, input, guidance, chunkText)

  // If boundary detection produced nothing usable, fall back to a single chapter.
  if (!boundaries.length) {
    return validateChapters([{ title: 'Full Video', startSeconds: 0 }], input.durationSeconds, guidance)
  }

  const chapters = await titleAndRefine(
    apiKey,
    input,
    guidance,
    boundaries,
    buildBoundaryContextText(input, boundaries),
    input.regenerateContext,
  )

  // Pass 2 can fail to return usable titles; fall back to the raw boundaries.
  const resolved = chapters.length
    ? chapters
    : boundaries.map((boundary) => ({ title: boundary.topicSummary, startSeconds: boundary.startSeconds }))

  return validateChapters(resolved, input.durationSeconds, guidance)
}

/** Pass 1 — detect topic-shift boundaries with high recall. */
async function detectBoundaries(
  apiKey: string,
  input: ChapterRequest,
  guidance: ChapterGuidance,
  chunkText: string,
): Promise<Boundary[]> {
  const durationMinutes = Math.round(input.durationSeconds / 60)

  const prompt = `You are segmenting a long-form YouTube video transcript into navigable sections.

## Video
- Title: ${input.title}
- Duration: ${durationMinutes} minutes (${input.durationSeconds} seconds)
- Transcript sections provided: ${input.chunks.length}

## Your task (PASS 1 of 2: boundary detection)
Find EVERY point where the video shifts to a new sub-topic, step, or section. Maximize recall — it is better to over-detect here because a later pass will merge redundant splits.

Even when the whole video is about ONE overall subject (e.g. a tutorial on a single algorithm), mark each distinct sub-section, such as:
- problem statement / setup
- intuition or approach explanation
- dry run / walkthrough of an example
- code implementation
- complexity or correctness analysis
- edge cases
- testing / running the code
- recap or conclusion

This is a **${guidance.durationLabel}** video. Expect roughly **${guidance.minChapters}–${guidance.maxChapters}** boundaries, but include more if real shifts exist.

Return a JSON array:
[{"startSeconds":0,"topicSummary":"short phrase describing what STARTS here"}]

## Timestamp rules (IMPORTANT for accuracy)
- Every transcript line is prefixed with \`@<seconds>\` marking when it is spoken (e.g. \`@372 now let's look at...\`).
- Set \`startSeconds\` to the \`@<seconds>\` value of the line where the new topic actually begins — NOT the section header time.
- If the shift happens partway through, choose the marker at or just BEFORE the first sentence of the new topic. Prefer landing slightly early over slightly late.
- Strictly increasing order, no duplicates. The first boundary must be at startSeconds 0.
- \`topicSummary\`: 2–6 words, describing the content that begins at that point (this is NOT the final title).

## Transcript (lines are prefixed with @<seconds>)
${chunkText}`

  const result = await callGemini<Boundary>(apiKey, prompt, {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        startSeconds: { type: 'INTEGER' },
        topicSummary: { type: 'STRING' },
      },
      required: ['startSeconds', 'topicSummary'],
    },
  })

  return result
    .filter((item) => typeof item.startSeconds === 'number' && typeof item.topicSummary === 'string')
    .map((item) => ({
      startSeconds: Math.max(0, Math.floor(item.startSeconds)),
      topicSummary: item.topicSummary.trim(),
    }))
    .sort((a, b) => a.startSeconds - b.startSeconds)
}

/** Pass 2 — turn boundaries into final titled chapters, merging/splitting as needed. */
async function titleAndRefine(
  apiKey: string,
  input: ChapterRequest,
  guidance: ChapterGuidance,
  boundaries: Boundary[],
  boundaryContextText: string,
  regenerateContext?: ChapterRequest['regenerateContext'],
): Promise<Chapter[]> {
  const durationMinutes = Math.round(input.durationSeconds / 60)
  const idealMinutes = Math.round(guidance.idealChapterLengthSeconds / 60)

  const boundaryList = boundaries
    .map((boundary) => `- ${formatTimestamp(boundary.startSeconds)} (startSeconds=${boundary.startSeconds}): ${boundary.topicSummary}`)
    .join('\n')

  const nuancedSection =
    regenerateContext?.reasonType === 'nuanced'
      ? `
## Viewer preference (nuanced regeneration)
The viewer requested nuanced regeneration: "${regenerateContext.userReason.replace(/"/g, '\\"')}".
Prefer more/fewer boundaries or thematic grouping as described, while respecting min/max chapter budgets.
`
      : ''

  const prompt = `You are finalizing navigation chapters for a YouTube video.

## Video
- Title: ${input.title}
- Duration: ${durationMinutes} minutes (${input.durationSeconds} seconds)
${nuancedSection}
## Your task (PASS 2 of 2: titling + merge/split)
Pass 1 detected the candidate section starts below (with high recall, so some may be redundant). Produce the final, clean list of chapters.

- MERGE adjacent candidates that are really the same topic or too granular to deserve their own chapter.
- SPLIT a candidate into two only if it clearly covers two distinct major topics.
- Aim for **${guidance.minChapters}–${guidance.maxChapters}** chapters for this **${guidance.durationLabel}** video, roughly ${idealMinutes} minute(s) apart on average — but follow the real structure over equal spacing.
- Keep meaningful sub-sections of a single-topic video (a focused tutorial should still yield several chapters, not one).

## Candidate boundaries (from Pass 1)
${boundaryList}

## Output
Return a JSON array:
[{"title":"Clear descriptive chapter name","startSeconds":0}]

## Title rules
- 3–8 words, specific and scannable (good: "DFS Traversal Walkthrough", bad: "More Stuff")
- Use the speaker's framing when they name a section; no timestamps in titles
- The first chapter should reflect how the video actually opens

## Timestamp rules
- Excerpts below are short windows around each Pass 1 boundary (lines prefixed with \`@<seconds>\`).
- Reuse a Pass 1 candidate's \`startSeconds\` when it already matches where the topic begins.
- Only adjust a timestamp when an excerpt shows a more precise \`@<seconds>\` marker at or just BEFORE the first sentence of the topic.
- Strictly increasing order, no duplicates; first chapter at or near 0

## Transcript excerpts (around each boundary)
${boundaryContextText}`

  return callGemini<Chapter>(apiKey, prompt, {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING' },
        startSeconds: { type: 'INTEGER' },
      },
      required: ['title', 'startSeconds'],
    },
  })
}

// Each chunk's text already contains inline `@<seconds>` markers (~10s apart)
// produced by the client segmenter. Keep them intact so the model can anchor a
// chapter to the exact moment a topic begins. Cap defensively for pathological
// chunks without dropping the typical chunk's tail.
function buildChunkText(input: ChapterRequest): string {
  return input.chunks
    .map((chunk) => {
      const start = formatTimestamp(chunk.startSeconds)
      const end = formatTimestamp(chunk.endSeconds)
      return `### ${start} – ${end}\n${chunk.text.slice(0, 4000)}`
    })
    .join('\n\n')
}

const PASS2_CONTEXT_BEFORE_SECONDS = 30
const PASS2_CONTEXT_AFTER_SECONDS = 60
const PASS2_CONTEXT_MAX_CHARS = 12_000

interface TimestampedLine {
  seconds: number
  text: string
}

function parseTimestampedLines(chunks: ChapterRequest['chunks']): TimestampedLine[] {
  const lines: TimestampedLine[] = []

  for (const chunk of chunks) {
    for (const line of chunk.text.split('\n')) {
      const match = line.match(/^@(\d+)\s+(.*)$/)
      if (!match) continue
      lines.push({ seconds: Number(match[1]), text: match[2].trim() })
    }
  }

  return lines.sort((a, b) => a.seconds - b.seconds)
}

function buildBoundaryContextText(input: ChapterRequest, boundaries: Boundary[]): string {
  const lines = parseTimestampedLines(input.chunks)
  if (!lines.length) return buildChunkText(input)

  const sections = boundaries.map((boundary) => {
    const windowStart = Math.max(0, boundary.startSeconds - PASS2_CONTEXT_BEFORE_SECONDS)
    const windowEnd = boundary.startSeconds + PASS2_CONTEXT_AFTER_SECONDS
    const excerpt = lines
      .filter((line) => line.seconds >= windowStart && line.seconds <= windowEnd)
      .map((line) => `@${line.seconds} ${line.text}`)
      .join('\n')

    const header = `### Around ${formatTimestamp(boundary.startSeconds)} (candidate startSeconds=${boundary.startSeconds})`
    return excerpt ? `${header}\n${excerpt}` : `${header}\n(no transcript in window)`
  })

  let text = sections.join('\n\n')
  if (text.length > PASS2_CONTEXT_MAX_CHARS) {
    text = `${text.slice(0, PASS2_CONTEXT_MAX_CHARS)}\n\n[excerpts truncated]`
  }

  return text
}

async function callGemini<T>(apiKey: string, prompt: string, responseSchema: unknown): Promise<T[]> {
  let response: Response
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.15,
            responseMimeType: 'application/json',
            responseSchema,
          },
        }),
        signal: AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS),
      },
    )
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('Gemini request timed out', { cause: error })
    }
    throw error
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Gemini request failed (${response.status}): ${errorText.slice(0, 200)}`)
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }

  const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'
  const jsonMatch = content.match(/\[[\s\S]*\]/)

  try {
    return JSON.parse(jsonMatch?.[0] ?? content) as T[]
  } catch {
    return []
  }
}
