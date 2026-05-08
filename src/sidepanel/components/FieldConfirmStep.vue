<script setup lang="ts">
import { inject, computed } from 'vue'
import type { TaskStateContext } from '../composables/useTaskState'

const taskCtx = inject<TaskStateContext>('taskCtx')!

const fields = computed(() => taskCtx.analyzedFields.value)
const itemSelector = computed(() => taskCtx.analyzedItemSelector.value)

function toggleField(index: number) {
  const current = taskCtx.analyzedFields.value
  if (current[index]) {
    current[index] = { ...current[index], enabled: !current[index].enabled }
    // Trigger reactivity
    taskCtx.analyzedFields.value = [...current]
  }
}

function handleConfirm() {
  const enabled = fields.value.filter((f) => f.enabled)
  taskCtx.confirmFields(enabled, '', itemSelector.value)
}

function handleDetectPagination() {
  // Must confirm fields before advancing to step 4
  const enabled = fields.value.filter((f) => f.enabled)
  taskCtx.confirmFields(enabled, '', itemSelector.value)
  taskCtx.detectPagination().then(() => {
    taskCtx.currentStep.index = 4
  })
}
</script>

<template>
  <div class="space-y-4">
    <div class="text-center">
      <h2 class="text-lg font-bold text-gray-800">确认字段</h2>
      <p class="text-xs text-gray-500 mt-1">选择需要抓取的数据字段</p>
    </div>

    <!-- Fields -->
    <div v-if="fields.length > 0" class="space-y-2">
      <div
        v-for="(field, idx) in fields"
        :key="idx"
        class="flex items-start gap-3 p-3 rounded-lg border transition cursor-pointer"
        :class="field.enabled ? 'border-primary-300 bg-primary-50' : 'border-gray-200 bg-white opacity-60'"
        @click="toggleField(idx)"
      >
        <input
          type="checkbox"
          :checked="field.enabled"
          class="mt-0.5 w-4 h-4 text-primary-600 rounded focus:ring-primary-500 shrink-0"
          @click.stop
          @change="toggleField(idx)"
        />
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium text-gray-800">{{ field.name }}</div>
          <div v-if="field.description" class="text-xs text-gray-500">{{ field.description }}</div>
          <div v-if="field.sampleValue" class="text-xs text-gray-400 mt-0.5 truncate">
            示例: {{ field.sampleValue }}
          </div>
        </div>
      </div>
    </div>

    <!-- No fields (shouldn't normally happen - but handle gracefully) -->
    <div v-else class="text-center py-8 text-gray-400">
      <p>AI 未识别到数据字段</p>
      <p class="text-xs mt-1">请返回重新选取包含更多数据的元素</p>
    </div>

    <div class="flex gap-2">
      <button
        @click="handleDetectPagination"
        class="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 transition"
      >
        检测分页
      </button>
      <button
        @click="handleConfirm"
        :disabled="!fields.some(f => f.enabled)"
        class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        确认字段
      </button>
    </div>
  </div>
</template>
