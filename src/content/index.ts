// ============================================================
// Content Script
//
// Responsibilities:
// 1. Element selection mode (hover highlight, click to select)
// 2. Data extraction from DOM using selectors
// 3. Pagination execution (click-based, URL-based, scroll-based)
// 4. Scraping loop orchestration
// 5. Visual feedback overlay (Shadow DOM isolated)
// ============================================================

import { MessageType, type MessageEnvelope } from '@/shared/messages'
import type {
  SelectorConfig,
  PaginationConfig,
  ClickPaginationConfig,
  UrlPaginationConfig,
  ScrollPaginationConfig,
  ScrapedRow,
} from '@/shared/types'
import { PREPROCESSOR_CONFIG } from '@/shared/types'

// --- State ---
let isSelectorMode = false
let selectedElement: HTMLElement | null = null
let highlightOverlay: HTMLElement | null = null
let scraperRunning = false
let scraperAbortController: AbortController | null = null

// --- Message Listener ---
chrome.runtime.onMessage.addListener(
  (message: MessageEnvelope, _sender, sendResponse) => {
    if (message.target !== 'content') return false

    handleMessage(message.type as MessageType, message.payload)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: (err as Error).message }))

    return true
  }
)

async function handleMessage(type: MessageType, payload: unknown): Promise<unknown> {
  switch (type) {
    case MessageType.START_SELECTOR_MODE:
      startSelectorMode()
      return { success: true }

    case MessageType.STOP_SELECTOR_MODE:
      stopSelectorMode()
      return { success: true }

    case MessageType.DETECT_PAGINATION:
      return detectPaginationCandidates()

    case MessageType.CONFIRM_PAGINATION:
      // Just acknowledge — pagination config is passed in start scraping
      return { success: true }

    case MessageType.START_SCRAPING:
      return startScraping(payload as StartScrapingMsg)

    case MessageType.PAUSE_SCRAPING:
      scraperRunning = false
      return { success: true }

    case MessageType.RESUME_SCRAPING:
      scraperRunning = true
      return { success: true }

    case MessageType.STOP_SCRAPING:
      scraperRunning = false
      scraperAbortController?.abort()
      scraperAbortController = null
      return { success: true }

    default:
      return { error: `Unknown message: ${type}` }
  }
}

// --- Selector Mode ---
function startSelectorMode(): void {
  if (isSelectorMode) return
  isSelectorMode = true

  // Create highlight overlay using Shadow DOM for isolation
  highlightOverlay = document.createElement('div')
  highlightOverlay.id = 'crawler-highlight-overlay'
  highlightOverlay.style.cssText = `
    position: fixed; pointer-events: none; z-index: 2147483646;
    border: 2px solid #3b82f6; border-radius: 4px;
    background: rgba(59, 130, 246, 0.08);
    transition: all 0.15s ease;
    display: none;
  `
  document.body.appendChild(highlightOverlay)

  document.addEventListener('mouseover', onHover, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKeyDown, true)

  document.body.style.cursor = 'crosshair'
}

function stopSelectorMode(): void {
  isSelectorMode = false
  highlightOverlay?.remove()
  highlightOverlay = null

  document.removeEventListener('mouseover', onHover, true)
  document.removeEventListener('click', onClick, true)
  document.removeEventListener('keydown', onKeyDown, true)

  document.body.style.cursor = ''
}

function onHover(e: MouseEvent): void {
  if (!isSelectorMode || !highlightOverlay) return
  const target = e.target as HTMLElement
  highlightElement(target)
}

function onClick(e: MouseEvent): void {
  if (!isSelectorMode) return
  e.preventDefault()
  e.stopPropagation()

  const target = e.target as HTMLElement
  selectedElement = target

  const html = target.outerHTML

  // Notify background -> sidepanel
  chrome.runtime.sendMessage({
    type: MessageType.ELEMENT_SELECTED,
    source: 'content',
    target: 'background',
    payload: {
      html: html.substring(0, PREPROCESSOR_CONFIG.MAX_HTML_SIZE),
      text: target.textContent?.trim()?.substring(0, 2000) ?? '',
      selector: getUniqueSelector(target),
      rect: target.getBoundingClientRect(),
    },
  })

  stopSelectorMode()
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    stopSelectorMode()
    chrome.runtime.sendMessage({
      type: MessageType.STOP_SELECTOR_MODE,
      source: 'content',
      target: 'background',
      payload: {},
    })
  }
}

function highlightElement(el: HTMLElement): void {
  if (!highlightOverlay) return
  const rect = el.getBoundingClientRect()
  highlightOverlay.style.display = 'block'
  highlightOverlay.style.top = `${rect.top + window.scrollY}px`
  highlightOverlay.style.left = `${rect.left + window.scrollX}px`
  highlightOverlay.style.width = `${rect.width}px`
  highlightOverlay.style.height = `${rect.height}px`
}

// --- Pagination Detection ---
async function detectPaginationCandidates(): Promise<{
  candidates: Array<{ selector: string; text: string; type: string; confidence: number }>
}> {
  const candidates: Array<{
    selector: string
    text: string
    type: string
    confidence: number
  }> = []

  // Search for common pagination patterns
  const patterns = [
    { text: /^下一页|next|下一頁|›|»/i, type: 'next' as const, confidence: 0.9 },
    { text: /^上一页|prev|previous|‹|«/i, type: 'page-number' as const, confidence: 0.5 },
    { text: /^加载更多|load more|show more/i, type: 'load-more' as const, confidence: 0.85 },
  ]

  const allElements = document.querySelectorAll('a, button, [role="button"], span')

  for (const el of allElements) {
    const text = el.textContent?.trim() ?? ''
    if (!text || text.length > 20) continue

    for (const pattern of patterns) {
      if (pattern.text.test(text)) {
        const selector = getUniqueSelector(el as HTMLElement)
        // Avoid duplicates
        if (!candidates.find((c) => c.selector === selector)) {
          candidates.push({ selector, text, type: pattern.type, confidence: pattern.confidence })
        }
      }
    }
  }

  // Also check for URL-based pagination patterns
  const urlParams = new URLSearchParams(window.location.search)
  for (const [key, value] of urlParams.entries()) {
    if (/^\d+$/.test(value) && key.toLowerCase().includes('page')) {
      candidates.push({
        selector: `URL:?${key}={n}`,
        text: `URL参数: ${key}=${value}`,
        type: 'next',
        confidence: 0.7,
      })
    }
  }

  // Send to background -> sidepanel
  chrome.runtime.sendMessage({
    type: MessageType.PAGINATION_CANDIDATES,
    source: 'content',
    target: 'background',
    payload: { candidates },
  })

  return { candidates }
}

[{"_raw":"// Helper functions for persisting seen hashes across page navigations\nasync function loadSeenHashes(taskId: string): Promise<Set<string>> {\n  const key = `scraped_hashes_${taskId}`\n  const result = await chrome.storage.local.get(key)\n  const hashes = result[key]\n  if (Array.isArray(hashes)) {\n    return new Set(hashes)\n  }\n  return new Set()\n}\n\nasync function persistSeenHashes(taskId: string"},{"_raw":"hashes: Set<string>): Promise<void> {\n  const key = `scraped_hashes_${taskId}`\n  await chrome.storage.local.set({ [key]: Array.from(hashes) })\n}\n\nasync function clearSeenHashes(taskId: string): Promise<void> {\n  const key = `scraped_hashes_${taskId}`\n  await chrome.storage.local.remove(key)\n}\n\n// --- Scraping ---"}]
interface StartScrapingMsg {
  taskId: string
  selectorConfig: SelectorConfig
  paginationConfig: PaginationConfig
  pageDelayMs: number
  maxPages?: number
}

async function startScraping(msg: StartScrapingMsg): Promise<{ success: boolean }> {
  scraperAbortController = new AbortController()
  scraperRunning = true

  const { taskId, selectorConfig, paginationConfig, pageDelayMs, maxPages = 50 } = msg
  const allRows: ScrapedRow[] = []

  // Restore previously persisted hashes so dedup survives page navigations
  const seenHashes = await loadSeenHashes(taskId)

  let pageIndex = 0
  let totalSkipped = 0

  const sendProgress = (pageIdx: number, itemsOnPage: number, latestRows: ScrapedRow[]) => {
    chrome.runtime.sendMessage({
      type: MessageType.SCRAPING_PROGRESS,
      source: 'content',
      target: 'background',
      payload: {
        taskId,
        pageIndex: pageIdx,
        itemsOnPage,
        totalItems: allRows.length,
        skippedItems: totalSkipped,
        latestRows: latestRows.slice(-5),
      },
    })
  }

  let hadError = false

  try {
    while (scraperRunning && pageIndex < maxPages) {
      // Extract data from current page
      const rows = extractData(selectorConfig, pageIndex)
      let newItems = 0
      let pageSkipped = 0

      for (const row of rows) {
        if (!seenHashes.has(row.hash)) {
          seenHashes.add(row.hash)
          allRows.push(row)
          newItems++
        } else {
          pageSkipped++
        }
      }

      totalSkipped += pageSkipped

      // Persist hashes after each page so they survive navigation/reload
      await persistSeenHashes(taskId, seenHashes)

      sendProgress(pageIndex, newItems, rows)

      if (newItems === 0 && pageIndex > 0) {
        // No new items — likely reached the end
        break
      }

      // Navigate to next page
      const hasNext = await navigateNextPage(paginationConfig, pageDelayMs)
      if (!hasNext) break

      pageIndex++
    }
  } catch (err) {
    hadError = true
    if ((err as Error).name !== 'AbortError') {
      chrome.runtime.sendMessage({
        type: MessageType.SCRAPING_ERROR,
        source: 'content',
        target: 'background',
        payload: {
          taskId,
          errorType: 'unknown',
          message: (err as Error).message,
          pageIndex,
        },
      })
    }
  }

  scraperRunning = false

  // Clean up persisted hashes for this task on completion
  if (!hadError) {
    chrome.runtime.sendMessage({
      type: MessageType.SCRAPING_COMPLETE,
      source: 'content',
      target: 'background',
      payload: { taskId, totalItems: allRows.length },
    })
  }

  // Store data in IndexedDB via background
  chrome.runtime.sendMessage({
    type: MessageType.STORE_SCRAPED_DATA,
    source: 'content',
    target: 'background',
    payload: { taskId, rows: allRows },
  })

  // Clear persisted hashes after store
  await clearSeenHashes(taskId)

  return { success: true }
}

function extractData(config: SelectorConfig, currentPageIndex: number): ScrapedRow[] {
  const items = document.querySelectorAll(config.itemSelector)
  const rows: ScrapedRow[] = []

  for (const item of items) {
    const data: Record<string, string> = {}
    const enabledFields = config.fields.filter((f) => f.enabled)

    for (const field of enabledFields) {
      const el = item.querySelector(field.selector)
      if (el) {
        const value = el.textContent?.trim() ?? ''
        data[field.name] = value.replace(/\s+/g, ' ').replace(/^[\s\u00A0]+|[\s\u00A0]+$/g, '')
      } else {
        data[field.name] = ''
      }
    }

    const hash = hashString(JSON.stringify(data))
    rows.push({
      id: generateId(),
      data,
      pageIndex: currentPageIndex,
      hash,
      scrapedAt: Date.now(),
    })
  }

  return rows
}
    }

    const hash = hashString(JSON.stringify(data))
    rows.push({
      id: generateId(),
      data,
      pageIndex: 0,
      hash,
      scrapedAt: Date.now(),
    })
  }

  return rows
}

async function navigateNextPage(
  config: PaginationConfig,
  delayMs: number
): Promise<boolean> {
  await sleep(delayMs)

  switch (config.type) {
    case 'click': {
      const cfg = config as ClickPaginationConfig
      const btn = document.querySelector(cfg.selector)
      if (!btn) {
        notifyError('pagination_lost', '未找到翻页元素')
        return false
      }
      ;(btn as HTMLElement).click()
      await sleep(cfg.waitMs)
      return true
    }

    case 'url': {
      const cfg = config as UrlPaginationConfig
      const currentUrl = new URL(window.location.href)
      const nextPage = parseInt(currentUrl.searchParams.get(cfg.paramName) ?? '1') + 1
      currentUrl.searchParams.set(cfg.paramName, String(nextPage))
      window.location.href = currentUrl.toString()
      return false // Page will reload - content script will be re-injected
    }

    case 'scroll': {
      const cfg = config as ScrollPaginationConfig
      // Simple scroll pagination
      const prevHeight = document.body.scrollHeight
      window.scrollTo(0, document.body.scrollHeight)
      await sleep(cfg.scrollDelayMs)
      return document.body.scrollHeight > prevHeight
    }

    default:
      return false
  }
}

function notifyError(type: string, message: string): void {
  chrome.runtime.sendMessage({
    type: MessageType.SCRAPING_ERROR,
    source: 'content',
    target: 'background',
    payload: { errorType: type, message },
  })
}

// --- Helpers ---
function getUniqueSelector(el: HTMLElement): string {
  if (el.id) return `#${CSS.escape(el.id)}`
  const path: string[] = []
  let current: HTMLElement | null = el
  while (current && current !== document.body) {
    let segment = current.tagName.toLowerCase()
    if (current.className) {
      const cls = current.className.trim().split(/\s+/).slice(0, 2).join('.')
      if (cls) segment += `.${cls}`
    }
    path.unshift(segment)
    current = current.parentElement
  }
  return path.join(' > ')
}

function hashString(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return String(hash)
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
