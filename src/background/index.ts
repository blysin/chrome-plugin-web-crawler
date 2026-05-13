// ============================================================
// Background Service Worker
//
// Responsibilities:
// 1. Message router between Content Script <-> Side Panel
// 2. AI API client (CORS-free fetch from SW context)
// 3. chrome.storage.local management (config, task state)
// 4. Template cache management
// ============================================================

import {type MessageEnvelope, type MessageRouter, MessageType} from '@/shared/messages'
import type {AiConfig, ParseTemplate, ScrapedRow, TaskState} from '@/shared/types'
import {AI_CONFIG as AI_CONSTANTS, STORAGE_KEYS} from '@/shared/types'
import {storeScrapedData} from '@/db'

// --- State ---
let aiConfig: AiConfig | null = null

// --- Message Routing ---
const router: MessageRouter = new Map()

// AI Config
// NOTE: apiKey is stored in chrome.storage.local (unencrypted).
// chrome.storage.session is NOT used because data must persist across
// browser restarts. Any user with DevTools access can read this value.
// For production deployments, consider using chrome.storage.session
// (ephemeral) or the WebCrypto API for encryption.
router.set(MessageType.SAVE_AI_CONFIG, async (payload) => {
  const { config } = payload as { config: AiConfig }
  aiConfig = config
  await chrome.storage.local.set({ [STORAGE_KEYS.AI_CONFIG]: config })
  return { success: true }
})

router.set(MessageType.GET_AI_CONFIG, async () => {
  if (!aiConfig) {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.AI_CONFIG)
    aiConfig = stored[STORAGE_KEYS.AI_CONFIG] ?? null
  }
  return aiConfig
})

router.set(MessageType.TEST_AI_CONNECTION, async (payload) => {
  const { config, sampleHtml } = payload as { config: AiConfig; sampleHtml: string }
  return testAiConnection(config, sampleHtml)
})

// HTML Analysis
router.set(MessageType.ANALYZE_HTML, async (payload) => {
  const { html, config } = payload as { html: string; config: AiConfig }
  return analyzeHtml(html, config)
})

// Forward messages from sidepanel to content script
router.set(MessageType.START_SELECTOR_MODE, async (payload) => {
  return sendToContent(MessageType.START_SELECTOR_MODE, payload)
})

router.set(MessageType.STOP_SELECTOR_MODE, async (payload) => {
  return sendToContent(MessageType.STOP_SELECTOR_MODE, payload)
})

router.set(MessageType.DETECT_PAGINATION, async (payload) => {
  return sendToContent(MessageType.DETECT_PAGINATION, payload)
})

router.set(MessageType.CONFIRM_PAGINATION, async (payload) => {
  return sendToContent(MessageType.CONFIRM_PAGINATION, payload)
})

router.set(MessageType.START_SCRAPING, async (payload) => {
  return sendToContent(MessageType.START_SCRAPING, payload)
})

router.set(MessageType.PAUSE_SCRAPING, async (payload) => {
  return sendToContent(MessageType.PAUSE_SCRAPING, payload)
})

router.set(MessageType.RESUME_SCRAPING, async (payload) => {
  return sendToContent(MessageType.RESUME_SCRAPING, payload)
})

router.set(MessageType.STOP_SCRAPING, async (payload) => {
  return sendToContent(MessageType.STOP_SCRAPING, payload)
})

// Forward progress & results from content --> sidepanel
router.set(MessageType.SCRAPING_PROGRESS, async (payload) => {
  forwardToSidePanel(MessageType.SCRAPING_PROGRESS, payload)
  return { ack: true }
})

router.set(MessageType.SCRAPING_COMPLETE, async (payload) => {
  forwardToSidePanel(MessageType.SCRAPING_COMPLETE, payload)
  return { ack: true }
})

router.set(MessageType.SCRAPING_ERROR, async (payload) => {
  forwardToSidePanel(MessageType.SCRAPING_ERROR, payload)
  return { ack: true }
})

router.set(MessageType.ELEMENT_SELECTED, async (payload) => {
  forwardToSidePanel(MessageType.ELEMENT_SELECTED, payload)
  return { ack: true }
})

// Task State
router.set(MessageType.GET_TASK_STATE, async () => {
  return getTaskState()
})

router.set(MessageType.RESET_TASK, async () => {
  await chrome.storage.local.remove(STORAGE_KEYS.TASK_STATE)
  await chrome.storage.local.remove(STORAGE_KEYS.ACTIVE_TASK_ID)
  return { success: true }
})

// Template Cache
router.set(MessageType.SAVE_TEMPLATE, async (payload) => {
  const template = payload as ParseTemplate
  const stored = await chrome.storage.local.get(STORAGE_KEYS.TEMPLATES)
  const templates: ParseTemplate[] = stored[STORAGE_KEYS.TEMPLATES] ?? []
  const idx = templates.findIndex((t) => t.id === template.id)
  if (idx >= 0) {
    templates[idx] = template
  } else {
    templates.push(template)
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.TEMPLATES]: templates })
  return { success: true }
})

router.set(MessageType.LOAD_TEMPLATES, async () => {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.TEMPLATES)
  return stored[STORAGE_KEYS.TEMPLATES] ?? []
})

router.set(MessageType.DELETE_TEMPLATE, async (payload) => {
  const { id } = payload as { id: string }
  const stored = await chrome.storage.local.get(STORAGE_KEYS.TEMPLATES)
  const templates: ParseTemplate[] = stored[STORAGE_KEYS.TEMPLATES] ?? []
  await chrome.storage.local.set({
    [STORAGE_KEYS.TEMPLATES]: templates.filter((t) => t.id !== id),
  })
  return { success: true }
})

// Data Storage
router.set(MessageType.STORE_SCRAPED_DATA, async (payload) => {
  const { rows } = payload as { taskId: string; rows: ScrapedRow[] }
  if (rows && rows.length > 0) {
    const result = await storeScrapedData(rows)
    return { success: true, stored: result.stored, skipped: result.skipped }
  }
  return { success: true, stored: 0, skipped: 0 }
})

// Export
router.set(MessageType.EXPORT_CSV, async (payload) => {
  const { data, filename } = payload as { data: string; filename: string }
  const blob = new Blob(['\uFEFF' + data], { type: 'text/csv;charset=utf-8' })
  const reader = new FileReader()
  return new Promise((resolve) => {
    reader.onloadend = () => {
      chrome.downloads.download(
        {
          url: reader.result as string,
          filename,
          saveAs: true,
        },
        (downloadId) => resolve({ downloadId })
      )
    }
    reader.readAsDataURL(blob)
  })
})

// --- Message Listener ---
chrome.runtime.onMessage.addListener(
  (message: MessageEnvelope, sender, sendResponse) => {
    const handler = router.get(message.type as MessageType)
    if (!handler) {
      sendResponse({ error: `Unknown message type: ${message.type}` })
      return false
    }

    Promise.resolve(handler(message.payload, sender, message.requestId))
      .then(sendResponse)
      .catch((err) => sendResponse({ error: (err as Error).message }))

    return true // Keep channel open for async response
  }
)

// --- AI API Client ---
async function callAiApi(
  config: AiConfig,
  messages: Array<{ role: string; content: string }>,
  responseFormat?: { type: string }
): Promise<string> {
  let lastError: Error | null = null
  let useJsonFormat = responseFormat ?? { type: 'json_object' }
  let jsonModeRetried = false

  for (let attempt = 0; attempt < AI_CONSTANTS.MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), AI_CONSTANTS.TIMEOUT_MS)

      const body: Record<string, unknown> = {
        model: config.modelName,
        messages,
        temperature: 0.1,
      }
      // Only include response_format if we haven't retried without it
      if (useJsonFormat) {
        body.response_format = useJsonFormat
      }

      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errText = await response.text()
        // Check if the error indicates JSON mode is not supported
        if (
          useJsonFormat &&
          !jsonModeRetried &&
          /json.?mode|response_format|20024/i.test(errText)
        ) {
          // Retry without response_format — prompt already asks for JSON
          useJsonFormat = null
          jsonModeRetried = true
          continue // Don't count as a retry attempt
        }
        throw new Error(`AI API error ${response.status}: ${errText}`)
      }

      const data = await response.json()
      return data.choices?.[0]?.message?.content ?? ''
    } catch (err) {
      lastError = err as Error
      if (attempt < AI_CONSTANTS.MAX_RETRIES - 1) {
        await sleep(AI_CONSTANTS.RETRY_DELAY_MS)
      }
    }
  }

  throw lastError ?? new Error('AI API request failed after retries')
}

async function testAiConnection(
  config: AiConfig,
  sampleHtml: string
): Promise<{ success: boolean; message: string }> {
  try {
    const result = await callAiApi(config, [
      {
        role: 'user',
        content: `Extract field names from this HTML. Return JSON: {"fields":[{"name":"field_name","sampleValue":"example"}]}\n\nHTML:\n${sampleHtml.substring(0, 5000)}`,
      },
    ])
    let parsed: { fields?: Array<{ name: string; sampleValue: string }> }
    try {
      parsed = JSON.parse(result)
    } catch {
      return { success: false, message: `AI 返回了非 JSON 格式的响应：${result.substring(0, 200)}` }
    }
    return {
      success: true,
      message: `连接成功，检测到 ${parsed.fields?.length ?? 0} 个字段`,
    }
  } catch (err) {
    return { success: false, message: `连接失败: ${(err as Error).message}` }
  }
}

async function analyzeHtml(
  html: string,
  config: AiConfig
): Promise<{
  fields: Array<{ name: string; description: string; sampleValue: string }>
  itemSelector?: string
}> {
  const prompt = `You are a web scraping AI. Analyze this HTML fragment from a webpage.

Your task:
1. Identify repeating data items (like product cards, list rows, table rows)
2. For each data field (title, price, image, link, etc.), determine the CSS selector that locates it WITHIN each repeating item
3. Infer a CSS selector that matches each individual repeating data item
4. Return JSON with:
{
  "itemSelector": "css-selector-for-each-repeating-item",
  "fields": [
    {
      "name": "price",
      "selector": ".price, [class*='price'], span:contains('¥')",
      "description": "what this field represents",
      "sampleValue": "an example value from the HTML"
    }
  ]
}

CRITICAL: The "selector" for each field must be a CSS selector that finds that specific field INSIDE a single item element. Do NOT use global selectors - they must work when scoped to the item. For example, ".price" or "td:nth-child(2)" or "[data-field='title']".

IMPORTANT:
- Only include fields that actually appear in the HTML
- Field names should be descriptive (like "price", "title", "imageUrl")
- The itemSelector should select EACH repeating item, NOT the container
- Ignore navigation, ads, sidebars - focus on the main data list

HTML:
${html.substring(0, 30000)}`

  const result = await callAiApi(config, [{ role: 'user', content: prompt }], {
    type: 'json_object',
  })
  let parsed: { fields?: Array<{ name: string; description: string; sampleValue: string }>; itemSelector?: string }
  try {
    parsed = JSON.parse(result)
  } catch {
    // AI returned non-JSON — try to extract JSON from the response
    const jsonMatch = result.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0])
      } catch {
        throw new Error(`AI 返回了无法解析的格式：${result.substring(0, 200)}`)
      }
    } else {
      throw new Error(`AI 返回了非 JSON 格式的响应：${result.substring(0, 200)}`)
    }
  }
  return {
    fields: parsed.fields ?? [],
    itemSelector: parsed.itemSelector,
  }
}

// --- Helpers ---
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getTaskState(): Promise<TaskState | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.TASK_STATE)
  return stored[STORAGE_KEYS.TASK_STATE] ?? null
}

async function sendToContent(type: MessageType, payload: unknown): Promise<unknown> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('未找到活动标签页')
  if (!tab.url || !/^https?:\/\//i.test(tab.url)) {
    throw new Error('请在普通网页上使用此功能（不支持 chrome:// 或扩展页面）')
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, {
      type,
      source: 'background',
      target: 'content',
      payload,
    })
  } catch (err) {
    const message = (err as Error).message || ''
    if (message.includes('Receiving end does not exist') || message.includes('Could not establish connection')) {
      throw new Error('无法连接到当前页面，请确保页面已完全加载，然后刷新页面后重试')
    }
    throw err
  }
}

function forwardToSidePanel(type: MessageType, payload: unknown): void {
  chrome.runtime
    .sendMessage({
      type,
      source: 'background',
      target: 'sidepanel',
      payload,
    })
    .catch((err) => {
      console.warn(`[forwardToSidePanel] Failed to send ${type}:`, err?.message)
    })
}

// --- Startup ---
chrome.runtime.onInstalled.addListener(async () => {
  // Enable side panel for all URLs
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })

  // Check for incomplete tasks
  const task = await getTaskState()
  if (task && task.status === 'running') {
    // Task was interrupted — mark as paused for user to decide
    task.status = 'paused'
    task.updatedAt = Date.now()
    await chrome.storage.local.set({ [STORAGE_KEYS.TASK_STATE]: task })
  }
})
