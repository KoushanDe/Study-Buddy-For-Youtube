import {
  PROXY_FETCH_REQUEST_EVENT,
  PROXY_FETCH_RESPONSE_EVENT,
} from '../../shared/constants/transcript-events'

interface ProxyFetchRequestDetail {
  requestId: string
  url: string
  method: string
  headers?: Record<string, string>
  body?: string | null
}

export function installTranscriptFetchProxy(): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<ProxyFetchRequestDetail>).detail
    if (!detail?.requestId || !detail.url) return

    void fetch(detail.url, {
      method: detail.method,
      headers: detail.headers,
      body: detail.body ?? undefined,
    })
      .then(async (response) => {
        const body = await response.text()
        const headers: Record<string, string> = {}
        response.headers.forEach((value, key) => {
          headers[key] = value
        })

        document.dispatchEvent(
          new CustomEvent(PROXY_FETCH_RESPONSE_EVENT, {
            detail: {
              requestId: detail.requestId,
              status: response.status,
              statusText: response.statusText,
              headers,
              body,
            },
          }),
        )
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Proxy fetch failed'
        document.dispatchEvent(
          new CustomEvent(PROXY_FETCH_RESPONSE_EVENT, {
            detail: { requestId: detail.requestId, error: message },
          }),
        )
      })
  }

  document.addEventListener(PROXY_FETCH_REQUEST_EVENT, handler)
  return () => document.removeEventListener(PROXY_FETCH_REQUEST_EVENT, handler)
}
