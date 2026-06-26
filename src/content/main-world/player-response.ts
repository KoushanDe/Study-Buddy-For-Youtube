const EVENT_NAME = 'study-buddy-for-youtube-player-response'

function publishPlayerResponse(): void {
  const response = (window as Window & { ytInitialPlayerResponse?: unknown }).ytInitialPlayerResponse
  if (!response) return

  document.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: response }))
}

publishPlayerResponse()
document.addEventListener('yt-navigate-finish', publishPlayerResponse)

export {}
