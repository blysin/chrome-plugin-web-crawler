// ============================================================
// Shared type definitions for Chrome AI Web Crawler Plugin
// ============================================================

// --- AI Configuration ---
export interface AiConfig {
  baseUrl: string
  apiKey: string
  modelName: string
}

// --- Field Definition (AI extracted or user confirmed) ---
export interface FieldDefinition {
  name: string
  selector: string
  description: string
  enabled: boolean
  sampleValue?: string
}

// --- Template Cache Entry ---
export interface ParseTemplate {
  id: string
  domain: string
  urlPattern: string
  containerSelector: string
  fields: FieldDefinition[]
  itemSelector: string
  createdAt: number
  lastUsedAt: number
}

// --- Scraped Data Row ---
export interface ScrapedRow {
  id: string
  taskId: string
  data: Record<string, string>
  pageIndex: number
  position: number
  hash: string
  scrapedAt: number
}

// --- Pagination Config ---
export type PaginationType = 'click' | 'url' | 'scroll'

export interface ClickPaginationConfig {
  type: 'click'
  selector: string
  waitMs: number
}

export interface UrlPaginationConfig {
  type: 'url'
  paramName: string
  startPage: number
  endPage?: number
}

export interface ScrollPaginationConfig {
  type: 'scroll'
  scrollDelayMs: number
  maxScrolls?: number
}

export type PaginationConfig =
  | ClickPaginationConfig
  | UrlPaginationConfig
  | ScrollPaginationConfig

// --- Selector Config ---
export interface SelectorConfig {
  containerSelector: string
  itemSelector: string
  fields: FieldDefinition[]
}

// --- Task State Machine ---
export type TaskStatus = 'idle' | 'configuring' | 'running' | 'paused' | 'completed' | 'error'

export interface TaskError {
  type: 'ai_timeout' | 'pagination_lost' | 'captcha' | 'storage_full' | 'network' | 'unknown'
  message: string
  timestamp: number
}

export interface TaskState {
  id: string
  name: string
  status: TaskStatus
  targetUrl: string
  aiConfig: AiConfig
  selectorConfig: SelectorConfig | null
  paginationConfig: PaginationConfig | null
  currentPage: number
  totalItems: number
  pausedAtPage: number | null
  errors: TaskError[]
  createdAt: number
  updatedAt: number
  pageDelayMs: number
  maxPages?: number
}

// --- Storage Keys (chrome.storage.local) ---
export const STORAGE_KEYS = {
  TASK_STATE: 'task_state',
  AI_CONFIG: 'ai_config',
  ACTIVE_TASK_ID: 'active_task_id',
  TEMPLATES: 'parse_templates',
} as const

// --- IndexedDB ---
export const DB_CONFIG = {
  NAME: 'CrawlerDB',
  VERSION: 2,
  STORES: {
    SCRAPED_DATA: 'scrapedData',
    TEMPLATES: 'templates',
  },
} as const

// --- HTML Preprocessing ---
export const PREPROCESSOR_CONFIG = {
  MAX_HTML_SIZE: 30 * 1024, // 30KB hard cap
  STRIP_TAGS: ['script', 'style', 'noscript', 'iframe', 'svg', 'img'] as const,
  STRIP_ATTRIBUTES: ['style', 'class', 'id', 'data-*', 'onclick', 'onload', 'onerror'] as const,
}

// --- AI API ---
export const AI_CONFIG = {
  MAX_RETRIES: 3,
  TIMEOUT_MS: 30000,
  RETRY_DELAY_MS: 2000,
} as const
