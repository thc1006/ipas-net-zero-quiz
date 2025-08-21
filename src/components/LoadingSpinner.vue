<template>
  <div class="fixed inset-0 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm flex items-center justify-center z-40">
    <div class="text-center">
      <!-- Spinner -->
      <div class="loading-spinner w-12 h-12 mx-auto mb-4"></div>
      
      <!-- Loading text -->
      <p class="text-lg font-medium text-neutral-700 dark:text-neutral-300 chinese-text">
        正在載入測驗題目...
      </p>
      
      <!-- Progress dots -->
      <div class="flex justify-center space-x-1 mt-4">
        <div 
          v-for="i in 3" 
          :key="i"
          class="w-2 h-2 bg-primary-500 rounded-full animate-pulse"
          :style="{ animationDelay: `${i * 0.2}s` }"
        ></div>
      </div>
    </div>
  </div>
</template>

<script setup>
// Loading component doesn't need any reactive state
</script>