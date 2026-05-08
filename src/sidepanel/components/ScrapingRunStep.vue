<script setup lang="ts">
import { ref, computed } from 'vue'
import type { TaskState, ScrapedRow, PaginationConfig } from '@/shared/types'

const props = defineProps<{
  task: TaskState
  previewRows: ScrapedRow[]
  isRunning: boolean
  isPaused: boolean
  canResume: boolean
}>()

const emit = defineEmits<{
  start: [config: PaginationConfig]
  pause: []
  resume: []
  stop: []
  export: []
  'save-template': []
  reset: []
}>()

const pageDelay = ref(2)
const maxPages = ref(50)
const paginationType = ref<'click' | 'url' | 'scroll'>('click')
const showSettings = ref(false)
const clickSelector = ref('')
const urlParam = ref('page')

function handleStart() {
  let config: PaginationConfig

  switch (paginationType.value) {
    case 'click':
      config = { type: 'click', selector: clickSelector.value || 'a[rel="next"], .pagination .next', waitMs: pageDelay.value * 1000 }
      break
    case 'url':
      config = { type: 'url', paramName: urlParam.value, startPage: 1 }
      break
    case 'scroll':
      config = { type: 'scroll', scrollDelayMs: pageDelay.value * 1000 }
      break
  }

  emit('start', config)
}

const previewHeaders = computed(() => {
  if (props.previewRows.length === 0) return []
  return Object.keys(props.previewRows[0].data)
})

function getStatusBadge() {
  if (props.isRunning) return { text: '采集中', class: 'bg-blue-100 text-blue-700' }
  if (props.isPaused) return { text: '已暂停', class: 'bg-yellow-100 text-yellow-700' }
  if (props.task.status === 'completed') return { text: '已完成', class: 'bg-green-100 text-green-700' }
  if (props.task.status === 'error') return { text: '出错', class: 'bg-red-100 text-red-700' }
  return { text: '就绪', class: 'bg-gray-100 text-gray-700' }
}
</script>

<template>
  <div class="space-y-4">
    <div class="text-center">
      <h2 class="text-lg font-bold text-gray-800">运行采集</h2>
      <div class="flex items-center justify-center gap-2 mt-1">
        <span class="text-xs text-gray-500">状态：</span>
        <span class="text-xs px-2 py-0.5 rounded-full font-medium" :class="getStatusBadge().class">
          {{ getStatusBadge().text }}
        </span>
      </div>
    </div>

    <!-- Settings (collapsible) -->
    <div class="border border-gray-200 rounded-lg overflow-hidden">
      <button
        @click="showSettings = !showSettings"
        class="w-full px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center justify-between transition"
      >
        采集设置
        <svg class="w-4 h-4 transition-transform" :class="{ 'rotate-180': showSettings }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div v-if="showSettings" class="px-3 pb-3 space-y-3 border-t border-gray-100">
        <!-- Pagination Type -->
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">分页方式</label>
          <div class="flex gap-1">
            <button
              v-for="t in [{ v: 'click', l: '点击翻页' }, { v: 'url', l: 'URL 翻页' }, { v: 'scroll', l: '滚动加载' }]"
              :key="t.v"
              @click="paginationType = t.v as any"
              class="flex-1 px-2 py-1.5 text-xs rounded border transition"
              :class="paginationType === t.v ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600'"
            >
              {{ t.l }}
            </button>
          </div>
        </div>

        <!-- Pagination configs -->
        <div v-if="paginationType === 'click'">
          <label class="block text-xs font-medium text-gray-600 mb-1">翻页按钮选择器</label>
          <input v-model="clickSelector" type="text" placeholder="a[rel='next']" class="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none" />
        </div>
        <div v-if="paginationType === 'url'">
          <label class="block text-xs font-medium text-gray-600 mb-1">URL 参数名</label>
          <input v-model="urlParam" type="text" placeholder="page" class="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none" />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-medium text-gray-600 mb-1">翻页延迟 (秒)</label>
            <input v-model.number="pageDelay" type="number" min="1" max="30" class="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none" />
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-600 mb-1">最大页数</label>
            <input v-model.number="maxPages" type="number" min="1" max="500" class="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none" />
          </div>
        </div>
      </div>
    </div>

    <!-- Controls -->
    <div class="flex gap-2 flex-wrap">
      <button
        v-if="!isRunning && !isPaused && task.status !== 'completed'"
        @click="handleStart"
        class="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 transition min-w-[80px]"
      >
        ▶ 开始采集
      </button>
      <button
        v-if="isRunning"
        @click="emit('pause')"
        class="px-4 py-2.5 text-sm font-medium rounded-lg bg-yellow-500 text-white hover:bg-yellow-600 transition"
      >
        ⏸ 暂停
      </button>
      <button
        v-if="isPaused"
        @click="emit('resume')"
        class="px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
      >
        ▶ 继续
      </button>
      <button
        v-if="isRunning || isPaused"
        @click="emit('stop')"
        class="px-4 py-2.5 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition"
      >
        ⏹ 停止
      </button>
      <button
        v-if="task.totalItems > 0"
        @click="emit('export')"
        class="px-4 py-2.5 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition"
      >
        📥 导出 CSV
      </button>
      <button
        @click="emit('save-template')"
        class="px-3 py-2.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 transition"
        title="保存为模板，下次同网站直接复用"
      >
        💾 模板
      </button>
    </div>

    <!-- Progress -->
    <div v-if="task.totalItems > 0" class="bg-gray-100 rounded-lg p-3 space-y-1">
      <div class="flex justify-between text-xs text-gray-600">
        <span>当前页: {{ task.currentPage }}</span>
        <span>总数据: {{ task.totalItems }} 条</span>
      </div>
      <div class="w-full h-1.5 bg-gray-300 rounded-full overflow-hidden">
        <div class="h-full bg-primary-500 rounded-full transition-all duration-500" :style="{ width: isRunning ? '75%' : '100%' }" />
      </div>
    </div>

    <!-- Preview Table -->
    <div v-if="previewRows.length > 0" class="overflow-hidden border border-gray-200 rounded-lg">
      <div class="text-xs font-medium text-gray-500 px-3 py-2 bg-gray-50 border-b border-gray-200">
        数据预览 (最新 5 条)
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="bg-gray-50">
              <th
                v-for="h in previewHeaders"
                :key="h"
                class="px-2 py-1.5 text-left font-medium text-gray-600 whitespace-nowrap border-b border-gray-200"
              >
                {{ h }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, idx) in previewRows"
              :key="row.id || idx"
              class="border-b border-gray-100 hover:bg-gray-50 transition-colors"
            >
              <td
                v-for="h in previewHeaders"
                :key="h"
                class="px-2 py-1 text-gray-700 max-w-[150px] truncate"
              >
                {{ row.data[h] || '-' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Errors -->
    <div v-if="task.errors.length > 0" class="space-y-1">
      <div
        v-for="(err, idx) in task.errors"
        :key="idx"
        class="text-xs px-3 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg"
      >
        ⚠️ {{ err.message }}
      </div>
    </div>

    <!-- Reset -->
    <button
      @click="emit('reset')"
      class="w-full px-4 py-2 text-xs font-medium text-gray-400 hover:text-gray-600 transition"
    >
      重置任务
    </button>
  </div>
</template>
