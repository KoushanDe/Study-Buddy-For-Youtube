import {
  TRANSCRIPT_FETCH_TIMEOUT_MS,
  TRANSCRIPT_REQUEST_EVENT,
  TRANSCRIPT_RESPONSE_EVENT,
} from '../../shared/constants/transcript-events'
import type { TranscriptResult } from '../../shared/types/transcript'

interface TranscriptResponseDetail {
  requestId: string
  result?: TranscriptResult
  error?: string
}

export function fetchTranscriptFromPage(videoId: string): Promise<TranscriptResult> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID()

    const timeout = window.setTimeout(() => {
      document.removeEventListener(TRANSCRIPT_RESPONSE_EVENT, onResponse)
      reject(new Error('Transcript fetch timed out'))
    }, TRANSCRIPT_FETCH_TIMEOUT_MS)

    const onResponse = (event: Event) => {
      const detail = (event as CustomEvent<TranscriptResponseDetail>).detail
      if (!detail || detail.requestId !== requestId) return

      window.clearTimeout(timeout)
      document.removeEventListener(TRANSCRIPT_RESPONSE_EVENT, onResponse)

      if (detail.error) {
        reject(new Error(detail.error))
        return
      }

      if (!detail.result?.segments?.length) {
        reject(new Error('Transcript fetch returned no segments'))
        return
      }

      resolve(detail.result)
    }

    document.addEventListener(TRANSCRIPT_RESPONSE_EVENT, onResponse)
    document.dispatchEvent(
      new CustomEvent(TRANSCRIPT_REQUEST_EVENT, {
        detail: { requestId, videoId },
      }),
    )
  })
}
