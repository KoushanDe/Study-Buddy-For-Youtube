import type { Message } from '../types/messages'

export function sendMessage<T extends Message>(message: T): Promise<unknown> {
  return chrome.runtime.sendMessage(message)
}

export function sendMessageToTab<T extends Message>(tabId: number, message: T): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, message)
}
