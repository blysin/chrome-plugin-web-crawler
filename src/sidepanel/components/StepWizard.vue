<script setup lang="ts">
defineProps<{
  currentStep: number
  status: string
}>()

const steps = [
  { index: 1, label: 'AI 配置' },
  { index: 2, label: '选取元素' },
  { index: 3, label: '确认字段' },
  { index: 4, label: '运行采集' },
]
</script>

<template>
  <div class="px-4 pt-4 pb-2 shrink-0">
    <div class="flex items-center">
      <template v-for="(step, i) in steps" :key="step.index">
        <div class="flex flex-col items-center">
          <div
            class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all duration-300 border-2"
            :class="{
              'bg-primary-600 border-primary-600 text-white': currentStep === step.index,
              'bg-green-500 border-green-500 text-white': currentStep > step.index,
              'bg-white border-gray-300 text-gray-400': currentStep < step.index,
            }"
          >
            <span v-if="currentStep > step.index">✓</span>
            <span v-else>{{ step.index }}</span>
          </div>
          <span
            class="text-[10px] mt-0.5 font-medium"
            :class="{
              'text-primary-600': currentStep >= step.index,
              'text-gray-400': currentStep < step.index,
            }"
          >
            {{ step.label }}
          </span>
        </div>
        <div
          v-if="i < steps.length - 1"
          class="flex-1 h-0.5 mx-1 rounded transition-all duration-300"
          :class="currentStep > step.index ? 'bg-green-500' : 'bg-gray-200'"
        />
      </template>
    </div>
  </div>
</template>
