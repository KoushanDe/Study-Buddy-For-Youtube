const HINT_SEEN_KEY = 'yn-playlist-hint-seen'

export function shouldShowPlaylistHint(): boolean {
  try {
    return sessionStorage.getItem(HINT_SEEN_KEY) !== '1'
  } catch {
    return false
  }
}

export function markPlaylistHintShown(): void {
  try {
    sessionStorage.setItem(HINT_SEEN_KEY, '1')
  } catch {
    // ignore
  }
}
