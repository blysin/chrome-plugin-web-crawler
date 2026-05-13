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

// --- HTML Preprocessing ---
/**
 * Strip noise tags and attributes from HTML to reduce AI token usage.
 * Uses PREPROCESSOR_CONFIG settings for tag/attribute filtering.
 */
function preprocessHtml(html: string): string {
  // Use DOM parser for safe tag stripping
  const doc = new DOMParser().parseFromString(html, 'text/html')
  
  // Strip noise tags
  for (const tag of PREPROCESSOR_CONFIG.STRIP_TAGS) {
    doc.querySelectorAll(tag).forEach((el) => el.remove())
  }
  
  // Strip noise attributes from remaining elements
  const attrPatterns = PREPROCESSOR_CONFIG.STRIP_ATTRIBUTES
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of attrPatterns) {
      if (attr === 'data-*') {
        // Remove all data-* attributes
        for (let i = el.attributes.length - 1; i >= 0; i--) {
          if (el.attributes[i].name.startsWith('data-')) {
            el.removeAttribute(el.attributes[i].name)
          }
        }
      } else {
        el.removeAttribute(attr)
      }
    }
  })
  
  return doc.body?.innerHTML ?? html
}

// Helper: get cleaned HTML snippet from a container element
function getContainerHtml(containerSelector?: string): string {
  let html: string
  if (containerSelector) {
    const container = document.querySelector(containerSelector)
    html = container?.outerHTML ?? document.body.outerHTML
  } else {
    html = document.body.outerHTML
  }
  return html.substring(0, PREPROCESSOR_CONFIG.MAX_HTML_SIZE)
}

// --- State ---
let isSelectorMode = false
let selectedElement: HTMLElement | null = null
let highlightOverlay: HTMLElement | null = null
let scraperRunning = false
let scraperAbortController: AbortController | null = null
// Track active scraping params so resume can restart the loop
let activeScrapingMsg: StartScrapingMsg | null = null
let activePageIndex = 0
let activeTotalItems = 0
let activeTotalSkipped = 0
const SCRAPING_STATE_KEY = 'scraping_resume_state'

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
      // Persist scraping state so resume can pick up where we left off
      if (activeScrapingMsg) {
        await chrome.storage.local.set({
          [SCRAPING_STATE_KEY]: {
            msg: activeScrapingMsg,
            pageIndex: activePageIndex,
            totalItems: activeTotalItems,
            totalSkipped: activeTotalSkipped,
          },
        })
      }
      return { success: true }

    case MessageType.RESUME_SCRAPING:
      // Restore persisted scraping state and restart the loop
      {
        const saved = await chrome.storage.local.get(SCRAPING_STATE_KEY)
        const state = saved[SCRAPING_STATE_KEY]
        if (state?.msg) {
          // Clear saved state so we don't accidentally resume twice
          await chrome.storage.local.remove(SCRAPING_STATE_KEY)
          // Restart from saved page (seenHashes in storage will skip dupes)
          const msg: StartScrapingMsg = {
            ...state.msg,
            resumeFromPage: state.pageIndex,
            resumeTotalItems: state.totalItems,
          }
          // Fire and forget - the loop will post progress/completion messages
          startScraping(msg).catch((err) => {
            console.error('[ResumeScraping] Failed:', err)
          })
          return { success: true }
        }
        return { success: false, error: 'No saved state to resume from' }
      }

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

// Helper functions for persisting seen hashes across page navigations
async function loadSeenHashes(taskId: string): Promise<Set<string>> {
  const key = `scraped_hashes_${taskId}`
  const result = await chrome.storage.local.get(key)
  const hashes = result[key]
  if (Array.isArray(hashes)) {
    return new Set(hashes)
  }
  return new Set()
}

async function persistSeenHashes(taskId: string, hashes: Set<string>): Promise<void> {
  const key = `scraped_hashes_${taskId}`
  await chrome.storage.local.set({ [key]: Array.from(hashes) })
}

async function clearSeenHashes(taskId: string): Promise<void> {
  const key = `scraped_hashes_${taskId}`
  await chrome.storage.local.remove(key)
}

// --- Scraping ---
interface StartScrapingMsg {
  taskId: string
  selectorConfig: SelectorConfig
  paginationConfig: PaginationConfig
  pageDelayMs: number
  maxPages?: number
  resumeFromPage?: number
  resumeTotalItems?: number
}

async function startScraping(msg: StartScrapingMsg): Promise<{ success: boolean }> {
  scraperAbortController = new AbortController()
  scraperRunning = true

  const { taskId, selectorConfig, paginationConfig, pageDelayMs, maxPages = 50, resumeFromPage, resumeTotalItems } = msg

  // Track active params for pause/resume
  activeScrapingMsg = msg
  activePageIndex = resumeFromPage ?? 0
  activeTotalItems = resumeTotalItems ?? 0

  const allRows: ScrapedRow[] = []

  // Restore previously persisted hashes so dedup survives page navigations
  const seenHashes = await loadSeenHashes(taskId)

  let pageIndex = resumeFromPage ?? 0
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
      const rows = extractData(taskId, selectorConfig, pageIndex)
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
      activeTotalSkipped = totalSkipped

      // Persist hashes after each page so they survive navigation/reload
      await persistSeenHashes(taskId, seenHashes)

      // Update active state for pause/resume tracking
      activeTotalItems = (resumeTotalItems ?? 0) + allRows.length

      sendProgress(pageIndex, newItems, rows)

      if (newItems === 0 && pageIndex > 0) {
        // No new items — likely reached the end
        break
      }

      // Navigate to next page
      const hasNext = await navigateNextPage(paginationConfig, pageDelayMs)
      if (!hasNext) break

      pageIndex++
      activePageIndex = pageIndex
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
  activeScrapingMsg = null

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

function extractData(taskId: string, config: SelectorConfig, currentPageIndex: number): ScrapedRow[] {
  const items = document.querySelectorAll(config.itemSelector)
  const rows: ScrapedRow[] = []

  let position = 0
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
      taskId,
      data,
      pageIndex: currentPageIndex,
      position: position++,
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
    // Add nth-child for better uniqueness when siblings share the same tag
    const parent = current.parentElement
    if (parent) {
      const sameTagSiblings = Array.from(parent.children).filter(
        (c) => c.tagName === current!.tagName
      )
      if (sameTagSiblings.length > 1) {
        const index = sameTagSiblings.indexOf(current) + 1
        segment += `:nth-child(${index})`
      }
    }
    path.unshift(segment)
    current = parent
  }
  return path.join(' > ')
}

function hashString(str: string): string {
  // djb2 with 53-bit modulus — far lower collision rate than 32-bit
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) % 9007199254740991
  }
  return hash.toString(36)
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
