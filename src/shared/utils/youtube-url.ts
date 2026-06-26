export function getPlaylistId(url: URL = new URL(location.href)): string | null {
  if (url.pathname !== '/playlist') return null
  return url.searchParams.get('list')
}

export function getPlaylistIdFromUrl(urlString: string): string | null {
  try {
    return getPlaylistId(new URL(urlString))
  } catch {
    return null
  }
}

export function getVideoId(url: URL = new URL(location.href)): string | null {
  if (url.pathname === '/watch') {
    return url.searchParams.get('v')
  }
  if (url.pathname.startsWith('/shorts/')) {
    return url.pathname.split('/')[2] ?? null
  }
  return null
}

export function isPlaylistPage(url: URL = new URL(location.href)): boolean {
  return getPlaylistId(url) !== null
}

export function getVideoIdFromUrl(urlString: string): string | null {
  try {
    return getVideoId(new URL(urlString))
  } catch {
    return null
  }
}

export function isWatchUrl(urlString: string): boolean {
  return getVideoIdFromUrl(urlString) !== null
}

export function isWatchPage(url: URL = new URL(location.href)): boolean {
  return getVideoId(url) !== null
}
