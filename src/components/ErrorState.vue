<template>
  <div class="max-w-2xl mx-auto text-center animate-fade-in">
    <div class="quiz-card p-8">
      <!-- Error Icon -->
      <div class="inline-block p-4 bg-error-100 dark:bg-error-900/30 rounded-full mb-6">
        <svg class="w-16 h-16 text-error-600 dark:text-error-400" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
        </svg>
      </div>
      
      <!-- Error Message -->
      <h2 class="text-2xl font-bold text-neutral-800 dark:text-neutral-100 mb-4 chinese-text">
        發生錯誤
      </h2>
      
      <p class="text-lg text-neutral-600 dark:text-neutral-400 mb-6 chinese-text leading-relaxed">
        {{ message }}
      </p>
      
      <!-- Retry Button -->
      <button
        @click="$emit('retry')"
        class="nav-button-primary flex items-center justify-center space-x-2 mx-auto"
      >
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd"/>
        </svg>
        <span class="chinese-text">重新載入</span>
      </button>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  message: {
    type: String,
    default: '無法載入內容，請稍後再試。'
  }
})

const emit = defineEmits(['retry'])
</script>