import { parseEmbeddedJson } from '../../shared/utils/json-extract'

const EVENT_NAME = 'study-buddy-for-youtube-player-response'

let cachedResponse: Record<string, unknown> | null = null

function parseFromScripts(): Record<string, unknown> | null {
  return parseEmbeddedJson('ytInitialPlayerResponse = ')
}

export function parseYtInitialPlayerResponse(): Record<string, unknown> | null {
  if (cachedResponse) return cachedResponse
  return parseFromScripts()
}

export function listenForPlayerResponse(
  onResponse: (response: Record<string, unknown>) => void,
): () => void {
  const apply = (response: Record<string, unknown>) => {
    cachedResponse = response
    onResponse(response)
  }

  const fromScript = parseFromScripts()
  if (fromScript) apply(fromScript)

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<Record<string, unknown>>).detail
    if (detail) apply(detail)
  }

  document.addEventListener(EVENT_NAME, handler)

  const onNavigate = () => {
    cachedResponse = null
    const response = parseFromScripts()
    if (response) apply(response)
  }

  document.addEventListener('yt-navigate-finish', onNavigate)

  return () => {
    document.removeEventListener(EVENT_NAME, handler)
    document.removeEventListener('yt-navigate-finish', onNavigate)
  }
}

export function getCachedPlayerResponse(): Record<string, unknown> | null {
  return cachedResponse ?? parseFromScripts()
}
