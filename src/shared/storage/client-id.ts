const CLIENT_ID_KEY = 'clientId'

function generateUuid(): string {
  return crypto.randomUUID()
}

export async function getOrCreateClientId(): Promise<string> {
  const result = await chrome.storage.local.get(CLIENT_ID_KEY)
  const existing = result[CLIENT_ID_KEY]
  if (typeof existing === 'string' && existing.length > 0) {
    return existing
  }

  const clientId = generateUuid()
  await chrome.storage.local.set({ [CLIENT_ID_KEY]: clientId })
  return clientId
}
