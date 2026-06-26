type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? (value as UnknownRecord) : null
}

export function readYouTubeText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || null
  }

  const record = asRecord(value)
  if (!record) return null

  if (typeof record.simpleText === 'string') {
    const trimmed = record.simpleText.trim()
    return trimmed || null
  }

  if (Array.isArray(record.runs)) {
    const text = record.runs
      .map((run) => asRecord(run)?.text)
      .filter((part): part is string => typeof part === 'string')
      .join('')
      .trim()
    return text || null
  }

  return null
}

export function parseCountFromText(text: string | null): number | null {
  if (!text) return null
  const match = text.match(/([\d,]+)/)
  if (!match) return null
  return Number(match[1].replace(/,/g, ''))
}
