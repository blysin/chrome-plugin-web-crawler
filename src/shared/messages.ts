// ============================================================
// Message type definitions for inter-script communication
//
// Message flow: Content Script <-> Service Worker <-> Side Panel
// Service Worker acts as message router.
// ============================================================

import type {
  AiConfig,
  FieldDefinition,
  PaginationConfig,
  ScrapedRow,
  SelectorConfig,
  TaskState,
} from './types'

// --- Message Envelope ---
export type MessageSource = 'sidepanel' | 'content' | 'background'
export type MessageTarget = 'sidepanel' | 'content' | 'background'

export interface MessageEnvelope<T = unknown> {
  type: string
  source: MessageSource
  target: MessageTarget
  payload: T
  requestId?: string
}

// --- Action Types ---
export enum MessageType {
  // AI Config
  SAVE_AI_CONFIG = 'SAVE_AI_CONFIG',
  GET_AI_CONFIG = 'GET_AI_CONFIG',
  TEST_AI_CONNECTION = 'TEST_AI_CONNECTION',

  // Selector Mode
  START_SELECTOR_MODE = 'START_SELECTOR_MODE',
  STOP_SELECTOR_MODE = 'STOP_SELECTOR_MODE',
  ELEMENT_SELECTED = 'ELEMENT_SELECTED',
  ELEMENT_HOVERED = 'ELEMENT_HOVERED',

  // AI Parse
  ANALYZE_HTML = 'ANALYZE_HTML',
  ANALYZE_HTML_RESULT = 'ANALYZE_HTML_RESULT',

  // Fields
  CONFIRM_FIELDS = 'CONFIRM_FIELDS',
  FIELDS_CONFIRMED = 'FIELDS_CONFIRMED',

  // Scraping
  START_SCRAPING = 'START_SCRAPING',
  STOP_SCRAPING = 'STOP_SCRAPING',
  PAUSE_SCRAPING = 'PAUSE_SCRAPING',
  RESUME_SCRAPING = 'RESUME_SCRAPING',
  SCRAPING_PROGRESS = 'SCRAPING_PROGRESS',
  SCRAPING_COMPLETE = 'SCRAPING_COMPLETE',
  SCRAPING_ERROR = 'SCRAPING_ERROR',

  // Pagination
  DETECT_PAGINATION = 'DETECT_PAGINATION',
  PAGINATION_CANDIDATES = 'PAGINATION_CANDIDATES',
  CONFIRM_PAGINATION = 'CONFIRM_PAGINATION',

  // Task State
  GET_TASK_STATE = 'GET_TASK_STATE',
  TASK_STATE_UPDATED = 'TASK_STATE_UPDATED',
  RESTORE_TASK = 'RESTORE_TASK',
  RESET_TASK = 'RESET_TASK',

  // Data Management
  STORE_SCRAPED_DATA = 'STORE_SCRAPED_DATA',
  GET_PREVIEW_DATA = 'GET_PREVIEW_DATA',
  PREVIEW_DATA = 'PREVIEW_DATA',
  EXPORT_CSV = 'EXPORT_CSV',

  // Templates
  SAVE_TEMPLATE = 'SAVE_TEMPLATE',
  LOAD_TEMPLATES = 'LOAD_TEMPLATES',
  DELETE_TEMPLATE = 'DELETE_TEMPLATE',
}

// --- Payload Types ---
export interface SaveAiConfigPayload {
  config: AiConfig
}

export interface TestAiConnectionPayload {
  config: AiConfig
  sampleHtml: string
}

export interface ElementSelectedPayload {
  html: string
  text: string
  selector: string
  rect: { x: number; y: number; width: number; height: number }
}

export interface AnalyzeHtmlPayload {
  html: string
  config: AiConfig
}

export interface AnalyzeHtmlResultPayload {
  fields: FieldDefinition[]
  suggestedItemSelector?: string
  rawResponse: string
}

export interface ConfirmFieldsPayload {
  fields: FieldDefinition[]
  containerSelector: string
  itemSelector: string
}

export interface StartScrapingPayload {
  taskId: string
  selectorConfig: SelectorConfig
  paginationConfig: PaginationConfig
  pageDelayMs: number
  maxPages?: number
}

export interface ScrapingProgressPayload {
  taskId: string
  pageIndex: number
  itemsOnPage: number
  totalItems: number
  skippedItems: number
  latestRows: ScrapedRow[]
}

export interface ScrapingErrorPayload {
  taskId: string
  errorType: string
  message: string
  pageIndex: number
}

export interface PaginationCandidatesPayload {
  candidates: Array<{
    selector: string
    text: string
    type: 'next' | 'page-number' | 'load-more'
    confidence: number
  }>
}

export interface TaskStateUpdatedPayload {
  task: TaskState
}

// --- Message Factory ---
function createMessage<T>(
  type: MessageType,
  source: MessageSource,
  target: MessageTarget,
  payload: T,
  requestId?: string
): MessageEnvelope<T> {
  return { type, source, target, payload, requestId }
}

// --- Send message helpers ---
export async function sendToBackground<T, R>(
  type: MessageType,
  payload: T
): Promise<R> {
  return chrome.runtime.sendMessage(
    createMessage(type, 'content', 'background', payload)
  ) as Promise<R>
}

export async function sendToContent<T, R>(
  type: MessageType,
  payload: T,
  tabId?: number
): Promise<R> {
  const message = createMessage(type, 'background', 'content', payload)
  if (tabId !== undefined) {
    return chrome.tabs.sendMessage(tabId, message) as Promise<R>
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('No active tab found')
  return chrome.tabs.sendMessage(tab.id, message) as Promise<R>
}

export async function sendToSidePanel<T, R>(
  type: MessageType,
  payload: T
): Promise<R> {
  return chrome.runtime.sendMessage(
    createMessage(type, 'background', 'sidepanel', payload)
  ) as Promise<R>
}

// --- Message handler type ---
export type MessageHandler<T = unknown> = (
  payload: T,
  sender: chrome.runtime.MessageSender,
  requestId?: string
) => Promise<unknown> | unknown

export type MessageRouter = Map<MessageType, MessageHandler>
