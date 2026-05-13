<script setup lang="ts">
import { ref, computed, inject, watch } from 'vue'
import type { AiConfig } from '@/shared/types'
import type { TaskStateContext } from '../composables/useTaskState'

const props = withDefaults(defineProps<{
  mode?: 'step' | 'page'
}>(), {
  mode: 'step',
})

const emit = defineEmits<{
  close: []
}>()

const taskCtx = inject<TaskStateContext>('taskCtx')!

const testResult = ref<{ success: boolean; message: string } | null>(null)
const testing = ref(false)

const form = ref<AiConfig>({
  baseUrl: taskCtx?.task.aiConfig.baseUrl || 'https://api.openai.com/v1',
  apiKey: taskCtx?.task.aiConfig.apiKey || '',
  modelName: taskCtx?.task.aiConfig.modelName || 'gpt-4o',
})

// In page mode, sync form with loaded config (handles async loading)
if (props.mode === 'page') {
  watch(
    () => taskCtx?.task.aiConfig,
    (newConfig) => {
      if (newConfig && newConfig.baseUrl && newConfig.apiKey) {
        form.value = { ...newConfig }
      }
    },
    { deep: true, immediate: true }
  )
}

const isValid = computed(() => {
  return form.value.baseUrl.trim() && form.value.apiKey.trim() && form.value.modelName.trim()
})

async function handleTest() {
  if (!isValid.value || !taskCtx) return
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await taskCtx.testConnection(form.value, '<div class="item"><span class="title">Test</span><span class="price">$10</span></div>')
  } catch (e: any) {
    testResult.value = { success: false, message: e.message || '未知错误' }
  } finally {
    testing.value = false
  }
}

function handleSave() {
  if (!isValid.value || !taskCtx) return
  taskCtx.saveAiConfig({ ...form.value })
  if (props.mode === 'step') {
    taskCtx.currentStep.index = 2
  } else {
    testResult.value = { success: true, message: '配置已保存' }
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Header: differs between step and page mode -->
    <div v-if="mode === 'page'" class="flex items-center gap-2">
      <button
        @click="emit('close')"
        class="w-7 h-7 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition shrink-0"
        title="返回"
      >
        <svg class="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <h2 class="text-lg font-bold text-gray-800">AI 配置</h2>
    </div>
    <div v-else class="text-center">
      <h2 class="text-lg font-bold text-gray-800">配置 AI 连接</h2>
      <p class="text-xs text-gray-500 mt-1">支持任何兼容 OpenAI API 的服务（全局配置，一次设定）</p>
    </div>

    <p v-if="mode === 'page'" class="text-xs text-gray-500">支持任何兼容 OpenAI API 的服务</p>

    <div class="space-y-3">
      <div>
        <label class="block text-xs font-medium text-gray-600 mb-1">Base URL</label>
        <input
          v-model="form.baseUrl"
          type="text"
          placeholder="https://api.openai.com/v1"
          class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition"
        />
      </div>

      <div>
        <label class="block text-xs font-medium text-gray-600 mb-1">API Key</label>
        <input
          v-model="form.apiKey"
          type="password"
          placeholder="sk-..."
          class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition"
        />
      </div>

      <div>
        <label class="block text-xs font-medium text-gray-600 mb-1">Model Name</label>
        <input
          v-model="form.modelName"
          type="text"
          placeholder="gpt-4o"
          class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition"
        />
      </div>
    </div>

    <!-- Test Result -->
    <div
      v-if="testResult"
      class="text-xs px-3 py-2 rounded-lg"
      :class="testResult.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'"
    >
      {{ testResult.message }}
    </div>

    <div class="flex gap-2">
      <button
        @click="handleTest"
        :disabled="!isValid || testing"
        class="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        {{ testing ? '测试中...' : '测试连接' }}
      </button>
      <button
        @click="handleSave"
        :disabled="!isValid"
        class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        {{ mode === 'step' ? '保存并继续' : '保存配置' }}
      </button>
    </div>
  </div>
</template>
