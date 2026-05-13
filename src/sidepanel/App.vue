<script setup lang="ts">
import { ref, provide } from 'vue'
import { useTaskState } from './composables/useTaskState'
import StepWizard from './components/StepWizard.vue'
import AiConfigStep from './components/AiConfigStep.vue'
import ElementSelectStep from './components/ElementSelectStep.vue'
import FieldConfirmStep from './components/FieldConfirmStep.vue'
import ScrapingRunStep from './components/ScrapingRunStep.vue'

const taskCtx = useTaskState()
provide('taskCtx', taskCtx)

// 解构 ref/computed 到顶层，让 Vue 模板编译器自动解包
//（useTaskState 返回普通对象，嵌套 ref 不会自动解包）
const { showTemplatePrompt, matchedTemplates, loadTemplate, dismissTemplatePrompt } = taskCtx
const { isRunning, isPaused, canResume } = taskCtx

const showConfigPage = ref(false)

function openConfig() {
  showConfigPage.value = true
}

function closeConfig() {
  showConfigPage.value = false
}
</script>

<template>
  <div class="min-h-screen bg-gray-50 flex flex-col">
    <!-- Header -->
    <header class="bg-primary-600 text-white px-4 py-3 shadow-md shrink-0 flex items-center gap-3">
      <button
        v-if="!showConfigPage && taskCtx.currentStep.index > 1"
        @click="taskCtx.goBack()"
        class="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition shrink-0"
        title="返回上一步"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <h1 class="text-base font-semibold tracking-wide flex-1">AI Web Crawler</h1>
      <!-- Config Gear Icon -->
      <button
        @click="openConfig"
        class="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition shrink-0"
        title="AI 配置"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
    </header>

    <!-- Config Page -->
    <main v-if="showConfigPage" class="flex-1 px-4 pb-4 overflow-y-auto">
      <AiConfigStep mode="page" @close="closeConfig" />
    </main>

    <!-- Main Workflow -->
    <template v-else>
      <!-- Step Indicator -->
      <StepWizard :current-step="taskCtx.currentStep.index" :status="taskCtx.task.status" />

      <!-- Content Area -->
      <main class="flex-1 px-4 pb-4 overflow-y-auto">
        <Transition name="fade" mode="out-in">
          <ElementSelectStep
            v-if="taskCtx.currentStep.index === 1"
            key="step1"
          />
          <FieldConfirmStep
            v-else-if="taskCtx.currentStep.index === 2"
            key="step2"
          />
          <ScrapingRunStep
            v-else-if="taskCtx.currentStep.index === 3"
            key="step3"
            :task="taskCtx.task"
            :preview-rows="taskCtx.previewRows"
            :is-running="isRunning"
            :is-paused="isPaused"
            :can-resume="canResume"
            :skipped-count="taskCtx.skippedTotal"
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
    </template>

    <!-- Template Prompt Modal -->
    <div v-if="showTemplatePrompt" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/50" @click="dismissTemplatePrompt()"></div>
      <div class="relative bg-white rounded-xl shadow-2xl max-w-sm w-full mx-4 p-6 space-y-4">
        <h3 class="text-lg font-bold text-gray-800">发现缓存配置</h3>
        <p class="text-sm text-gray-600">
          检测到当前域名有 {{ matchedTemplates.length }} 个保存的采集配置，是否加载？
        </p>
        <div v-if="matchedTemplates[0]" class="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 space-y-1">
          <div>域名：{{ matchedTemplates[0].domain }}</div>
          <div>URL 模式：{{ matchedTemplates[0].urlPattern }}</div>
          <div>字段数：{{ matchedTemplates[0].fields.length }} 个</div>
          <div>创建时间：{{ new Date(matchedTemplates[0].createdAt).toLocaleDateString() }}</div>
        </div>
        <div class="flex gap-2">
          <button
            v-if="matchedTemplates[0]"
            @click="loadTemplate(matchedTemplates[0])"
            class="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition"
          >
            加载配置
          </button>
          <button
            @click="dismissTemplatePrompt()"
            class="px-4 py-2.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition"
          >
            忽略
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>

</style>
