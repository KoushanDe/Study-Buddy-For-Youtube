import { CACHE_TTL, STORAGE_KEYS } from '../constants'
import { isExtensionContextValid } from '../utils/extension-context'
import type { ChapterCacheEntry } from '../types/chapter'
import type { TranscriptCacheEntry } from '../types/transcript'

export interface Settings {
  enabled: boolean
}

const DEFAULT_SETTINGS: Settings = {
  enabled: true,
}

function isFresh(fetchedAt: number, ttl: number): boolean {
  return Date.now() - fetchedAt < ttl
}

async function readLocal<T>(key: string): Promise<T | undefined> {
  if (!isExtensionContextValid()) return undefined

  try {
    const result = await chrome.storage.local.get(key)
    return result[key] as T | undefined
  } catch {
    return undefined
  }
}

async function writeLocal(values: Record<string, unknown>): Promise<boolean> {
  if (!isExtensionContextValid()) return false

  try {
    await chrome.storage.local.set(values)
    return true
  } catch {
    return false
  }
}

export async function getSettings(): Promise<Settings> {
  const stored = await readLocal<Settings>(STORAGE_KEYS.settings)
  return { ...DEFAULT_SETTINGS, ...stored }
}

export async function getTranscriptCache(videoId: string): Promise<TranscriptCacheEntry | null> {
  const cache = (await readLocal<Record<string, TranscriptCacheEntry>>(STORAGE_KEYS.transcriptCache)) ?? {}
  const entry = cache[videoId]
  if (!entry || !isFresh(entry.fetchedAt, CACHE_TTL.transcript)) return null
  return entry
}

export async function setTranscriptCache(
  videoId: string,
  entry: Omit<TranscriptCacheEntry, 'fetchedAt'>,
): Promise<void> {
  const cache = (await readLocal<Record<string, TranscriptCacheEntry>>(STORAGE_KEYS.transcriptCache)) ?? {}
  cache[videoId] = { ...entry, fetchedAt: Date.now() }
  await writeLocal({ [STORAGE_KEYS.transcriptCache]: cache })
}

export async function getChapterCache(
  videoId: string,
  transcriptHash?: string,
): Promise<ChapterCacheEntry | null> {
  const cache = (await readLocal<Record<string, ChapterCacheEntry>>(STORAGE_KEYS.chapterCache)) ?? {}
  const entry = cache[videoId]
  if (!entry || !isFresh(entry.fetchedAt, CACHE_TTL.chapter)) return null
  if (transcriptHash && entry.transcriptHash && entry.transcriptHash !== transcriptHash) return null
  return entry
}

export async function setChapterCache(
  videoId: string,
  entry: Omit<ChapterCacheEntry, 'fetchedAt'>,
): Promise<void> {
  const cache = (await readLocal<Record<string, ChapterCacheEntry>>(STORAGE_KEYS.chapterCache)) ?? {}
  cache[videoId] = { ...entry, fetchedAt: Date.now() }
  await writeLocal({ [STORAGE_KEYS.chapterCache]: cache })
}

export async function markChapterCacheFeedbackSubmitted(videoId: string): Promise<void> {
  const cache =
    (await readLocal<Record<string, ChapterCacheEntry>>(STORAGE_KEYS.chapterCache)) ?? {}
  const entry = cache[videoId]
  if (!entry?.pendingFeedback) return

  cache[videoId] = {
    ...entry,
    pendingFeedback: { ...entry.pendingFeedback, feedbackSubmitted: true },
  }
  await writeLocal({ [STORAGE_KEYS.chapterCache]: cache })
}

export function hashTranscript(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i)
    hash |= 0
  }
  return String(hash)
}
