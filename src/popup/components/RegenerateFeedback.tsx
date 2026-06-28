import { useEffect, useState } from 'react'

interface RegenerateFeedbackProps {
  onFeedback: (satisfied: boolean) => void
  submitting: boolean
  thanksMessage: string | null
  onThanksDismiss: () => void
}

const THANKS_VISIBLE_MS = 5_000
const THANKS_FADE_MS = 500

function ThumbUpIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  )
}

function ThumbDownIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M17 14V2" />
      <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
    </svg>
  )
}

export function RegenerateFeedback({
  onFeedback,
  submitting,
  thanksMessage,
  onThanksDismiss,
}: RegenerateFeedbackProps) {
  const [fadeOut, setFadeOut] = useState(false)

  useEffect(() => {
    if (!thanksMessage) {
      setFadeOut(false)
      return
    }

    const fadeTimer = window.setTimeout(() => setFadeOut(true), THANKS_VISIBLE_MS)
    const dismissTimer = window.setTimeout(
      () => onThanksDismiss(),
      THANKS_VISIBLE_MS + THANKS_FADE_MS,
    )

    return () => {
      window.clearTimeout(fadeTimer)
      window.clearTimeout(dismissTimer)
    }
  }, [thanksMessage, onThanksDismiss])

  if (thanksMessage) {
    return (
      <div
        className={`text-xs text-[var(--yn-muted)] transition-opacity duration-500 ${
          fadeOut ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {thanksMessage}
      </div>
    )
  }

  return (
    <div className="rounded-md border border-[var(--yn-border)] bg-[var(--yn-surface)] p-2">
      <div className="text-xs font-medium">Are you satisfied with this result?</div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={submitting}
          onClick={() => onFeedback(true)}
          aria-label="Satisfied"
          className="inline-flex items-center gap-1 rounded-md border border-[var(--yn-border)] px-2 py-1 text-xs hover:border-[var(--yn-accent)] hover:text-[var(--yn-accent)] disabled:opacity-50"
        >
          <ThumbUpIcon />
          Like
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => onFeedback(false)}
          aria-label="Not satisfied"
          className="inline-flex items-center gap-1 rounded-md border border-[var(--yn-border)] px-2 py-1 text-xs hover:border-red-400 hover:text-red-400 disabled:opacity-50"
        >
          <ThumbDownIcon />
          Dislike
        </button>
      </div>
    </div>
  )
}
