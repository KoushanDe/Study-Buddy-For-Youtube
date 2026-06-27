import type { Message } from '../types/messages'
import {
  isExtensionContextValid,
  isExtensionMessagingError,
} from '../utils/extension-context'

export function sendMessage<T extends Message>(message: T): Promise<unknown> {
  if (!isExtensionContextValid()) {
    return Promise.resolve(undefined)
  }

  try {
    return chrome.runtime.sendMessage(message).catch((error: unknown) => {
      if (isExtensionMessagingError(error)) return undefined
      throw error
    })
  } catch (error) {
    if (isExtensionMessagingError(error)) {
      return Promise.resolve(undefined)
    }
    return Promise.reject(error)
  }
}

export function sendMessageToTab<T extends Message>(tabId: number, message: T): Promise<unknown> {
  if (!isExtensionContextValid()) {
    return Promise.resolve(undefined)
  }

  try {
    return chrome.tabs.sendMessage(tabId, message).catch((error: unknown) => {
      if (isExtensionMessagingError(error)) return undefined
      throw error
    })
  } catch (error) {
    if (isExtensionMessagingError(error)) {
      return Promise.resolve(undefined)
    }
    return Promise.reject(error)
  }
}
