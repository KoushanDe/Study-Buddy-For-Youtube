export function formatSuccessQuotaExceededMessage(resetsAtIso?: string): string {
  const iso = resetsAtIso || getNextQuotaResetAtIso()
  const resetsAt = new Date(iso)
  if (Number.isNaN(resetsAt.getTime())) {
    return "You've used all your regenerations for today. Try again tomorrow."
  }
  const formatted = resetsAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZoneName: 'short',
  })
  return `You've used all your regenerations for today. Try again on ${formatted}.`
}

export function getNextQuotaResetAtIso(): string {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  ).toISOString()
}

export function isSuccessQuotaExhausted(quota: {
  successful?: { remaining: number }
}): boolean {
  return (quota.successful?.remaining ?? 0) <= 0
}
