import {
  PROXY_FETCH_REQUEST_EVENT,
  PROXY_FETCH_RESPONSE_EVENT,
} from '../../shared/constants/transcript-events'

interface ProxyFetchResponseDetail {
  requestId: string
  status?: number
  statusText?: string
  headers?: Record<string, string>
  body?: string
  error?: string
}

const PROXY_FETCH_TIMEOUT_MS = 60_000

/**
 * Routes network calls from the MAIN world (BotGuard) through the extension
 * content script, which can call fetch without illegal-invocation errors.
 */
export function createExtensionProxiedFetch(): typeof fetch {
  return (input, init) => {
    const requestId = crypto.randomUUID()
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')

    const headers: Record<string, string> = {}
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((value, key) => {
          headers[key] = value
        })
      } else if (Array.isArray(init.headers)) {
        for (const [key, value] of init.headers) {
          headers[key] = value
        }
      } else {
        Object.assign(headers, init.headers)
      }
    } else if (input instanceof Request) {
      input.headers.forEach((value, key) => {
        headers[key] = value
      })
    }

    let body: string | null | undefined
    if (typeof init?.body === 'string') {
      body = init.body
    } else if (init?.body == null && input instanceof Request) {
      body = null
    } else if (init?.body != null) {
      body = String(init.body)
    }

    return new Promise<Response>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        document.removeEventListener(PROXY_FETCH_RESPONSE_EVENT, onResponse)
        reject(new Error('Proxy fetch timed out'))
      }, PROXY_FETCH_TIMEOUT_MS)

      const onResponse = (event: Event) => {
        const detail = (event as CustomEvent<ProxyFetchResponseDetail>).detail
        if (!detail || detail.requestId !== requestId) return

        window.clearTimeout(timeout)
        document.removeEventListener(PROXY_FETCH_RESPONSE_EVENT, onResponse)

        if (detail.error) {
          reject(new Error(detail.error))
          return
        }

        resolve(
          new Response(detail.body ?? '', {
            status: detail.status ?? 500,
            statusText: detail.statusText ?? '',
            headers: detail.headers,
          }),
        )
      }

      document.addEventListener(PROXY_FETCH_RESPONSE_EVENT, onResponse)
      document.dispatchEvent(
        new CustomEvent(PROXY_FETCH_REQUEST_EVENT, {
          detail: { requestId, url, method, headers, body },
        }),
      )
    })
  }
}
