export function isExtensionContextValid(): boolean {
  try {
    return Boolean(chrome.runtime?.id)
  } catch {
    return false
  }
}

export function isExtensionMessagingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('Extension context invalidated') ||
    message.includes('Receiving end does not exist') ||
    message.includes('Could not establish connection')
  )
}
