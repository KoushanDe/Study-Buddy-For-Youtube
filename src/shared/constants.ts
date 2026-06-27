export const SPEEDS = [1, 1.25, 1.5, 2] as const

export const PLAYER_RESPONSE_EVENT = 'study-buddy-for-youtube-player-response'

export const STORAGE_KEYS = {
  settings: 'settings',
  transcriptCache: 'transcriptCache',
  chapterCache: 'chapterCache',
} as const

export const CACHE_TTL = {
  transcript: 7 * 24 * 60 * 60 * 1000,
  chapter: 7 * 24 * 60 * 60 * 1000,
} as const

export const PLAYLIST_CONTAINER_SELECTORS = [
  'ytd-playlist-video-list-renderer',
  'ytd-browse[page-subtype="playlist"] #contents',
  'ytd-section-list-renderer',
] as const
