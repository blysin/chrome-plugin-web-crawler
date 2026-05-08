<script setup lang="ts">
import { ref, inject } from 'vue'
import { MessageType } from '@/shared/messages'
import { useChromeMessage } from '../composables/useChromeMessage'
import type { TaskStateContext } from '../composables/useTaskState'

const taskCtx = inject<TaskStateContext>('taskCtx')!
const { on } = useChromeMessage()

const selectedHtml = ref('')
const selectedSelector = ref('')
const analyzing = ref(false)
const aiError = ref('')
const selectError = ref('')

on(MessageType.ELEMENT_SELECTED, (payload: any) => {
  selectedHtml.value = payload.html
  selectedSelector.value = payload.selector
})

async function handleStartSelect() {
  selectError.value = ''
  try {
    await taskCtx?.startSelectorMode()
  } catch (e: any) {
    selectError.value = e.message || '启动选择模式失败'
  }
}

async function handleAnalyze() {
  if (!selectedHtml.value || !taskCtx) return
  analyzing.value = true
  aiError.value = ''
  try {
    await taskCtx.analyzeHtml(selectedHtml.value)
    // Analysis complete, fields stored in taskCtx.analyzedFields
    taskCtx.goToFieldConfirm()
  } catch (e: any) {
    aiError.value = e.message || 'AI 分析失败，请检查配置或重试'
  } finally {
    analyzing.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="text-center">
      <h2 class="text-lg font-bold text-gray-800">选取元素</h2>
      <p class="text-xs text-gray-500 mt-1">点击页面上的列表数据区域进行 AI 分析</p>
    </div>

    <button
      @click="handleStartSelect"
      class="w-full px-4 py-3 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition flex items-center justify-center gap-2"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
      </svg>
      {{ selectedHtml ? '重新选取' : '开始选取元素' }}
    </button>

    <div
      v-if="selectError"
      class="text-xs px-3 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg"
    >
      {{ selectError }}
    </div>

    <div
      v-if="selectedHtml"
      class="border border-primary-200 bg-primary-50 rounded-lg p-3 space-y-2"
    >
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium text-primary-700">已选中元素</span>
        <span class="text-[10px] text-primary-500 font-mono truncate max-w-[180px]">{{ selectedSelector }}</span>
      </div>
      <div class="text-[11px] text-gray-600 bg-white rounded p-2 max-h-24 overflow-y-auto font-mono whitespace-pre-wrap break-all">
        {{ selectedHtml.substring(0, 500) }}{{ selectedHtml.length > 500 ? '...' : '' }}
      </div>
      <button
        @click="handleAnalyze"
        :disabled="analyzing"
        class="w-full px-3 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        <template v-if="analyzing">
          <span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2 align-middle" />
          AI 分析中...
        </template>
        <template v-else>🤖 AI 分析字段</template>
      </button>
      <p v-if="aiError" class="text-xs text-red-600">{{ aiError }}</p>
    </div>

    <div class="bg-gray-100 rounded-lg p-3 text-xs text-gray-500 space-y-1">
      <p>💡 <strong>使用技巧：</strong></p>
      <ul class="list-disc list-inside space-y-0.5">
        <li>悬停时高亮显示可选取的元素</li>
        <li>点击一个<strong>列表项</strong>，AI 会自动识别同类元素</li>
        <li>按 <kbd class="px-1 py-0.5 bg-gray-200 rounded text-[10px]">Esc</kbd> 退出选取模式</li>
      </ul>
    </div>
  </div>
</template>
