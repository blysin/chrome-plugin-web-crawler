import { reactive, computed, ref, type Ref } from 'vue'
import type {
  TaskState,
  AiConfig,
  FieldDefinition,
  PaginationConfig,
  ScrapedRow,
  ParseTemplate,
} from '@/shared/types'
import { MessageType } from '@/shared/messages'
import { useChromeMessage } from './useChromeMessage'

function createEmptyTask(targetUrl = ''): TaskState {
  return {
    id: `task-${Date.now()}`,
    name: '',
    status: 'idle',
    targetUrl,
    aiConfig: { baseUrl: '', apiKey: '', modelName: 'gpt-4o' },
    selectorConfig: null,
    paginationConfig: null,
    currentPage: 0,
    totalItems: 0,
    pausedAtPage: null,
    errors: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pageDelayMs: 2000,
    maxPages: 50,
  }
}

export function useTaskState() {
  const { send, on } = useChromeMessage()
  const task = reactive<TaskState>(createEmptyTask())
  const currentStep = reactive({ index: 1 })
  const previewRows = reactive<ScrapedRow[]>([])
  const aiConfigLoaded = ref(false)

  // Analyzed fields storage (used by step 2→3 flow)
  const analyzedFields = ref<FieldDefinition[]>([])
  const analyzedItemSelector = ref('')

  const isRunning = computed(() => task.status === 'running')
  const isPaused = computed(() => task.status === 'paused')
  const canResume = computed(() => task.status === 'paused' && task.pausedAtPage !== null)

  // --- Load global AI config on init ---
  loadGlobalConfig()

  async function loadGlobalConfig() {
    const stored = await send<AiConfig | null>(MessageType.GET_AI_CONFIG, {})
    if (stored && stored.baseUrl && stored.apiKey) {
      task.aiConfig = stored
      aiConfigLoaded.value = true
      // If config already saved, skip to step 2 (element selection)
      currentStep.index = 2
    }
  }

  // --- Incoming message handlers ---
  on(MessageType.SCRAPING_PROGRESS, (payload) => {
    const p = payload as { pageIndex: number; totalItems: number; latestRows: ScrapedRow[] }
    task.currentPage = p.pageIndex
    task.totalItems = p.totalItems
    previewRows.splice(0, previewRows.length, ...p.latestRows)
  })

  on(MessageType.SCRAPING_COMPLETE, (payload) => {
    const p = payload as { totalItems: number }
    task.status = 'completed'
    task.totalItems = p.totalItems
  })

  on(MessageType.SCRAPING_ERROR, (payload) => {
    const p = payload as { errorType: string; message: string }
    task.errors.push({
      type: p.errorType as TaskState['errors'][0]['type'],
      message: p.message,
      timestamp: Date.now(),
    })
    task.status = 'error'
  })

  on(MessageType.ELEMENT_SELECTED, (payload) => {
    const p = payload as { html: string; text: string; selector: string }
    // Store the selected element info for analysis
    // The ElementSelectStep component handles this via its own listener
  })

  // --- Actions ---
  function goBack() {
    if (currentStep.index > 1) {
      currentStep.index--
    }
  }

  async function saveAiConfig(config: AiConfig) {
    await send(MessageType.SAVE_AI_CONFIG, { config })
    task.aiConfig = { ...config }
    aiConfigLoaded.value = true
  }

  async function testConnection(config: AiConfig, sampleHtml: string) {
    return send<{ success: boolean; message: string }>(MessageType.TEST_AI_CONNECTION, {
      config,
      sampleHtml,
    })
  }

  async function startSelectorMode() {
    await send(MessageType.START_SELECTOR_MODE, {})
  }

  async function analyzeHtml(html: string): Promise<{
    fields: FieldDefinition[]
    itemSelector?: string
  }> {
    const result = await send<{
      fields: Array<{ name: string; description: string; sampleValue: string }>
      itemSelector?: string
    }>(MessageType.ANALYZE_HTML, {
      html,
      config: task.aiConfig,
    })

    // Store result in composable state
    analyzedFields.value = (result.fields || []).map((f) => ({
      name: f.name,
      selector: f.selector || '',
      description: f.description || '',
      enabled: true,
      sampleValue: f.sampleValue || '',
    }))
    analyzedItemSelector.value = result.itemSelector || ''

    return {
      fields: analyzedFields.value,
      itemSelector: analyzedItemSelector.value,
    }
  }

  function goToFieldConfirm() {
    currentStep.index = 3
  }

  async function confirmFields(
    fields: FieldDefinition[],
    containerSelector: string,
    itemSelector: string
  ) {
    task.selectorConfig = { containerSelector, itemSelector, fields }
    currentStep.index = 4
  }

  async function detectPagination() {
    const result = await send<{
      candidates: Array<{ selector: string; text: string; type: string; confidence: number }>
    }>(MessageType.DETECT_PAGINATION, {})
    return result
  }

  async function startScraping(paginationConfig: PaginationConfig) {
    task.status = 'running'
    task.paginationConfig = paginationConfig
    await send(MessageType.START_SCRAPING, {
      taskId: task.id,
      selectorConfig: task.selectorConfig!,
      paginationConfig,
      pageDelayMs: task.pageDelayMs,
      maxPages: task.maxPages,
    })
  }

  async function pauseScraping() {
    task.status = 'paused'
    task.pausedAtPage = task.currentPage
    await send(MessageType.PAUSE_SCRAPING, {})
  }

  async function resumeScraping() {
    task.status = 'running'
    await send(MessageType.RESUME_SCRAPING, {})
  }

  async function stopScraping() {
    await send(MessageType.STOP_SCRAPING, {})
    task.status = 'completed'
  }

  async function exportCsv(): Promise<void> {
    const { exportToCsv } = await import('@/db/index')
    const csv = await exportToCsv(task.id)
    await send(MessageType.EXPORT_CSV, {
      data: csv,
      filename: `${task.name || 'crawler-export'}-${Date.now()}.csv`,
    })
  }

  async function saveTemplate(): Promise<void> {
    if (!task.selectorConfig) return
    const url = new URL(task.targetUrl)
    const template: ParseTemplate = {
      id: `tpl-${Date.now()}`,
      domain: url.hostname,
      urlPattern: url.pathname,
      containerSelector: task.selectorConfig.containerSelector,
      itemSelector: task.selectorConfig.itemSelector,
      fields: task.selectorConfig.fields,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    }
    await send(MessageType.SAVE_TEMPLATE, template)
  }

  async function loadTemplates(): Promise<ParseTemplate[]> {
    return send(MessageType.LOAD_TEMPLATES, {})
  }

  function resetTask() {
    Object.assign(task, createEmptyTask())
    currentStep.index = aiConfigLoaded.value ? 2 : 1
    previewRows.splice(0)
    analyzedFields.value = []
    analyzedItemSelector.value = ''
  }

  return {
    task,
    currentStep,
    previewRows,
    aiConfigLoaded,
    analyzedFields,
    analyzedItemSelector,
    isRunning,
    isPaused,
    canResume,
    goBack,
    saveAiConfig,
    testConnection,
    startSelectorMode,
    analyzeHtml,
    goToFieldConfirm,
    confirmFields,
    detectPagination,
    startScraping,
    pauseScraping,
    resumeScraping,
    stopScraping,
    exportCsv,
    saveTemplate,
    loadTemplates,
    resetTask,
  }
}

export type TaskStateContext = ReturnType<typeof useTaskState>
