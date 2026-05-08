import { ref, onMounted, onUnmounted, type Ref } from 'vue'
import { MessageType, type MessageEnvelope } from '@/shared/messages'

type MessageCallback = (payload: unknown) => void

const listeners = new Map<MessageType, Set<MessageCallback>>()

export function useChromeMessage() {
  const connected = ref(false)
  const lastError = ref<string | null>(null)

  const messageHandler = (
    message: MessageEnvelope,
    _sender: chrome.runtime.MessageSender,
    _sendResponse: (response?: unknown) => void
  ) => {
    if (message.target !== 'sidepanel') return false

    const cbs = listeners.get(message.type as MessageType)
    if (cbs) {
      for (const cb of cbs) {
        try {
          cb(message.payload)
        } catch (e) {
          console.error('Message handler error:', e)
        }
      }
    }
    return false
  }

  onMounted(() => {
    chrome.runtime.onMessage.addListener(messageHandler)
    connected.value = true
  })

  onUnmounted(() => {
    chrome.runtime.onMessage.removeListener(messageHandler)
    connected.value = false
    listeners.clear()
  })

  function on(type: MessageType, callback: MessageCallback): () => void {
    if (!listeners.has(type)) {
      listeners.set(type, new Set())
    }
    listeners.get(type)!.add(callback)
    return () => {
      listeners.get(type)?.delete(callback)
    }
  }

  async function send<T = unknown>(type: MessageType, payload: unknown): Promise<T> {
    try {
      lastError.value = null
      const response = await chrome.runtime.sendMessage({
        type,
        source: 'sidepanel',
        target: 'background',
        payload,
      } as MessageEnvelope)
      if (response?.error) {
        throw new Error(response.error)
      }
      return response as T
    } catch (err) {
      lastError.value = (err as Error).message
      throw err
    }
  }

  return { connected, lastError, on, send }
}
