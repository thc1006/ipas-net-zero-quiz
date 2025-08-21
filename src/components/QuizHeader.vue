<template>
  <header class="mb-8 animate-fade-in">
    <!-- Quiz Title -->
    <div class="text-center mb-6">
      <h1 class="text-3xl lg:text-4xl font-bold text-neutral-800 dark:text-neutral-100 chinese-text mb-2">
        {{ quizTitle }}
      </h1>
      <p class="text-lg text-neutral-600 dark:text-neutral-400 chinese-text">
        準備好接受挑戰了嗎？
      </p>
    </div>
    
    <!-- Progress Section -->
    <div class="max-w-2xl mx-auto">
      <!-- Question Counter -->
      <div class="flex justify-between items-center mb-3">
        <span class="text-sm font-medium text-neutral-600 dark:text-neutral-400 chinese-text">
          進度
        </span>
        <span class="text-sm font-bold text-primary-600 dark:text-primary-400 chinese-text">
          第 {{ currentQuestion }} 題 / 共 {{ totalQuestions }} 題
        </span>
      </div>
      
      <!-- Progress Bar -->
      <div class="progress-bar">
        <div 
          class="progress-fill animate-progress"
          :style="{ width: `${progress}%`, '--progress-width': `${progress}%` }"
        ></div>
      </div>
      
      <!-- Progress Percentage -->
      <div class="text-center mt-2">
        <span class="text-xs text-neutral-500 dark:text-neutral-400 font-medium">
          {{ Math.round(progress) }}% 完成
        </span>
      </div>
    </div>
    
    <!-- Subject Badge (if available) -->
    <div v-if="currentSubject" class="text-center mt-4">
      <span class="inline-block px-4 py-2 bg-primary-100 dark:bg-primary-900/30 text-primary-800 dark:text-primary-200 rounded-full text-sm font-medium chinese-text">
        {{ currentSubject }}
      </span>
    </div>
  </header>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  currentQuestion: {
    type: Number,
    required: true
  },
  totalQuestions: {
    type: Number,
    required: true
  },
  progress: {
    type: Number,
    required: true
  },
  quizTitle: {
    type: String,
    default: '台灣 iPAS 淨零碳認證測驗'
  },
  currentSubject: {
    type: String,
    default: null
  }
})

// You could extract subject from current question if needed
// const currentSubject = computed(() => {
//   // Extract from question data if available
//   return null
// })
</script>