import { PLAYER_RESPONSE_EVENT } from '../../shared/constants'
import { parseEmbeddedJson } from '../../shared/utils/json-extract'

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

  document.addEventListener(PLAYER_RESPONSE_EVENT, handler)

  const onNavigate = () => {
    cachedResponse = null
  }

  document.addEventListener('yt-navigate-finish', onNavigate)

  return () => {
    document.removeEventListener(PLAYER_RESPONSE_EVENT, handler)
    document.removeEventListener('yt-navigate-finish', onNavigate)
  }
}
