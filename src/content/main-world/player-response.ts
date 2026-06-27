import { PLAYER_RESPONSE_EVENT } from '../../shared/constants'

function publishPlayerResponse(): void {
  const response = (window as Window & { ytInitialPlayerResponse?: unknown }).ytInitialPlayerResponse
  if (!response) return

  document.dispatchEvent(new CustomEvent(PLAYER_RESPONSE_EVENT, { detail: response }))
}

publishPlayerResponse()
document.addEventListener('yt-navigate-finish', publishPlayerResponse)

export {}
