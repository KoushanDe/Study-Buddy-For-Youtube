const PREFIX = '[Study Buddy for YouTube]'

function isDebugEnabled(): boolean {
  try {
    return localStorage.getItem('yn-debug') === '1'
  } catch {
    return false
  }
}

export function ynLog(scope: string, message: string, data?: unknown): void {
  if (!isDebugEnabled()) return
  if (data !== undefined) {
    console.log(`${PREFIX} [${scope}] ${message}`, data)
  } else {
    console.log(`${PREFIX} [${scope}] ${message}`)
  }
}
