export function extractJsonObject(text: string, start: number): string | null {
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i += 1) {
    const char = text[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return text.slice(start, i + 1)
      }
    }
  }

  return null
}

export function parseEmbeddedJson(marker: string): Record<string, unknown> | null {
  const scripts = document.querySelectorAll('script')
  for (const script of scripts) {
    const text = script.textContent ?? ''
    const index = text.indexOf(marker)
    if (index === -1) continue

    const jsonText = extractJsonObject(text, index + marker.length)
    if (!jsonText) continue

    try {
      return JSON.parse(jsonText) as Record<string, unknown>
    } catch {
      continue
    }
  }

  return null
}
