import { useState } from 'react'
import type { RegenerateQuota } from '../../shared/types/regenerate'
import {
  formatSuccessQuotaExceededMessage,
  isSuccessQuotaExhausted,
} from '../../shared/utils/quota-reset'

const MAX_REASON_LENGTH = 100

interface RegenerateModalProps {
  open: boolean
  quota: RegenerateQuota
  loading: boolean
  onClose: () => void
  onSubmit: (reason: string) => void
}

export function RegenerateModal({
  open,
  quota,
  loading,
  onClose,
  onSubmit,
}: RegenerateModalProps) {
  const [reason, setReason] = useState('')

  if (!open) return null

  const successQuotaExhausted = isSuccessQuotaExhausted(quota)

  const canSubmit =
    reason.trim().length > 0 &&
    reason.length <= MAX_REASON_LENGTH &&
    !loading &&
    !quota.onCooldown &&
    !successQuotaExhausted

  return (
    <div
      role="dialog"
      aria-labelledby="regenerate-modal-title"
      className="rounded-lg border border-[var(--yn-border)] bg-[var(--yn-surface)] p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 id="regenerate-modal-title" className="text-sm font-semibold">
          Regenerate chapters
        </h3>
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          aria-label="Close"
          className="shrink-0 rounded-md px-1 text-lg leading-none text-[var(--yn-muted)] hover:text-[var(--yn-text)] disabled:opacity-50"
        >
          ×
        </button>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-[var(--yn-muted)]">
        Study Buddy is free to use. Please use regenerate only when you genuinely need better
        chapters, it helps keep the service available for everyone.{' '}
        <a
          href="https://buymeacoffee.com/koushan"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--yn-accent)] hover:underline"
        >
          Support the project
        </a>
      </p>

      {successQuotaExhausted ? (
        <p className="mt-3 text-xs text-amber-400">
          {formatSuccessQuotaExceededMessage(quota.resetsAt)}
        </p>
      ) : null}

      {quota.onCooldown ? (
        <p className="mt-3 text-xs text-amber-400">
          Regenerate is on cooldown for this video. Try again after the feedback period ends.
        </p>
      ) : null}

      <label className="mt-3 block text-xs font-medium" htmlFor="regenerate-reason">
        Why do you need to regenerate?
      </label>
      <textarea
        id="regenerate-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value.slice(0, MAX_REASON_LENGTH))}
        rows={3}
        placeholder="e.g. chapters miss the second half of the video"
        disabled={successQuotaExhausted || quota.onCooldown || loading}
        className="mt-1 w-full resize-none rounded-md border border-[var(--yn-border)] bg-[var(--yn-bg)] px-2 py-1.5 text-sm outline-none focus:border-[var(--yn-accent)] disabled:cursor-not-allowed disabled:opacity-50"
      />
      <div className="mt-0.5 text-right text-xs text-[var(--yn-muted)]">
        {reason.length}/{MAX_REASON_LENGTH}
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="rounded-md px-3 py-1.5 text-xs text-[var(--yn-muted)] hover:bg-[var(--yn-bg)] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSubmit(reason.trim())}
          disabled={!canSubmit}
          className="rounded-md bg-[var(--yn-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Regenerating…' : 'Regenerate'}
        </button>
      </div>
    </div>
  )
}
