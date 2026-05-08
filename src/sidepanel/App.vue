<script setup lang="ts">
import { provide, onMounted } from 'vue'
import { useTaskState } from './composables/useTaskState'
import StepWizard from './components/StepWizard.vue'
import AiConfigStep from './components/AiConfigStep.vue'
import ElementSelectStep from './components/ElementSelectStep.vue'
import FieldConfirmStep from './components/FieldConfirmStep.vue'
import ScrapingRunStep from './components/ScrapingRunStep.vue'

const taskCtx = useTaskState()
provide('taskCtx', taskCtx)
</script>

<template>
  <div class="min-h-screen bg-gray-50 flex flex-col">
    <!-- Header -->
    <header class="bg-primary-600 text-white px-4 py-3 shadow-md shrink-0 flex items-center gap-3">
      <button
        v-if="taskCtx.currentStep.index > 1"
        @click="taskCtx.goBack()"
        class="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition shrink-0"
        title="返回上一步"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <h1 class="text-base font-semibold tracking-wide">AI Web Crawler</h1>
    </header>

    <!-- Step Indicator -->
    <StepWizard :current-step="taskCtx.currentStep.index" :status="taskCtx.task.status" />

    <!-- Content Area -->
    <main class="flex-1 px-4 pb-4 overflow-y-auto">
      <Transition name="fade" mode="out-in">
        <AiConfigStep
          v-if="taskCtx.currentStep.index === 1"
          key="step1"
        />
        <ElementSelectStep
          v-else-if="taskCtx.currentStep.index === 2"
          key="step2"
        />
        <FieldConfirmStep
          v-else-if="taskCtx.currentStep.index === 3"
          key="step3"
        />
        <ScrapingRunStep
          v-else-if="taskCtx.currentStep.index === 4"
          key="step4"
          :task="taskCtx.task"
          :preview-rows="taskCtx.previewRows"
          :is-running="taskCtx.isRunning"
          :is-paused="taskCtx.isPaused"
          :can-resume="taskCtx.canResume"
          @start="taskCtx.startScraping"
          @pause="taskCtx.pauseScraping"
          @resume="taskCtx.resumeScraping"
          @stop="taskCtx.stopScraping"
          @export="taskCtx.exportCsv"
          @save-template="taskCtx.saveTemplate"
          @reset="taskCtx.resetTask"
        />
      </Transition>
    </main>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
