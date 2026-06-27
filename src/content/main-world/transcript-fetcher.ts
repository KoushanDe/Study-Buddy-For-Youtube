import {
  TRANSCRIPT_REQUEST_EVENT,
  TRANSCRIPT_RESPONSE_EVENT,
} from '../../shared/constants/transcript-events'
import { createExtensionProxiedFetch } from './proxy-fetch'
import {
  bindTranscriptFetch,
  fetchTranscriptViaInnertube,
} from '../../services/transcript/transcript-fetcher-core'

bindTranscriptFetch(createExtensionProxiedFetch())

document.addEventListener(TRANSCRIPT_REQUEST_EVENT, ((event: CustomEvent<{ requestId: string; videoId: string }>) => {
  const { requestId, videoId } = event.detail
  if (!requestId || !videoId) return

  void fetchTranscriptViaInnertube(videoId)
    .then((result) => {
      document.dispatchEvent(
        new CustomEvent(TRANSCRIPT_RESPONSE_EVENT, {
          detail: { requestId, result },
        }),
      )
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Transcript fetch failed'
      document.dispatchEvent(
        new CustomEvent(TRANSCRIPT_RESPONSE_EVENT, {
          detail: { requestId, error: message },
        }),
      )
    })
}) as EventListener)

export {}
