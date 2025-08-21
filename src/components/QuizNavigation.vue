<template>
  <nav class="max-w-4xl mx-auto mt-8 animate-fade-in">
    <div class="flex items-center justify-between p-4 bg-white dark:bg-neutral-800 rounded-xl shadow-lg border border-neutral-200 dark:border-neutral-700">
      <!-- Previous Button -->
      <button
        @click="$emit('previous')"
        :disabled="!canGoPrevious"
        class="nav-button-secondary flex items-center space-x-2"
        :aria-label="'返回第 ' + (currentQuestion - 1) + ' 題'"
      >
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd" />
        </svg>
        <span class="chinese-text">上一題</span>
      </button>
      
      <!-- Question Indicator -->
      <div class="flex items-center space-x-4">
        <!-- Question Numbers (on larger screens) -->
        <div class="hidden md:flex items-center space-x-1">
          <button
            v-for="n in Math.min(totalQuestions, 10)"
            :key="n"
            @click="goToQuestion(n - 1)"
            class="w-8 h-8 rounded-full text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
            :class="getQuestionIndicatorClass(n - 1)"
            :aria-label="'前往第 ' + n + ' 題'"
            :aria-current="currentQuestion === n ? 'step' : undefined"
          >
            {{ n }}
          </button>
          
          <!-- Show ellipsis if more than 10 questions -->
          <span v-if="totalQuestions > 10" class="text-neutral-400 dark:text-neutral-500 px-2">
            ...
          </span>
        </div>
        
        <!-- Current Question Display (on mobile) -->
        <div class="md:hidden text-center">
          <div class="text-sm font-medium text-neutral-600 dark:text-neutral-400 chinese-text">
            第 {{ currentQuestion }} 題 / 共 {{ totalQuestions }} 題
          </div>
          <div v-if="!hasSelected" class="text-xs text-warning-600 dark:text-warning-400 mt-1 chinese-text">
            請選擇答案
          </div>
        </div>
      </div>
      
      <!-- Next/Submit Button -->
      <button
        v-if="!isLastQuestion"
        @click="$emit('next')"
        :disabled="!canGoNext || !hasSelected"
        class="nav-button-primary flex items-center space-x-2"
        :aria-label="'前往第 ' + (currentQuestion + 1) + ' 題'"
      >
        <span class="chinese-text">下一題</span>
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
        </svg>
      </button>
      
      <button
        v-else
        @click="$emit('submit')"
        :disabled="!hasSelected"
        class="nav-button-primary flex items-center space-x-2 bg-success-600 hover:bg-success-700 active:bg-success-800 focus:ring-success-500"
        aria-label="提交測驗"
      >
        <span class="chinese-text">提交測驗</span>
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
        </svg>
      </button>
    </div>
    
    <!-- Selection Status (on larger screens) -->
    <div class="hidden md:block mt-4 text-center">
      <div v-if="!hasSelected && !isLastQuestion" class="text-sm text-warning-600 dark:text-warning-400 chinese-text">
        請選擇答案後繼續
      </div>
      <div v-else-if="!hasSelected && isLastQuestion" class="text-sm text-warning-600 dark:text-warning-400 chinese-text">
        請選擇答案後提交測驗
      </div>
      <div v-else class="text-sm text-success-600 dark:text-success-400 chinese-text">
        已選擇答案，可以繼續
      </div>
    </div>
  </nav>
</template>

<script setup>
const props = defineProps({
  currentQuestion: {
    type: Number,
    required: true
  },
  totalQuestions: {
    type: Number,
    required: true
  },
  canGoPrevious: {
    type: Boolean,
    default: false
  },
  canGoNext: {
    type: Boolean,
    default: false
  },
  hasSelected: {
    type: Boolean,
    default: false
  },
  isLastQuestion: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['previous', 'next', 'submit', 'go-to-question'])

const goToQuestion = (questionIndex) => {
  emit('go-to-question', questionIndex)
}

const getQuestionIndicatorClass = (questionIndex) => {
  const isCurrent = props.currentQuestion - 1 === questionIndex
  
  if (isCurrent) {
    return 'bg-primary-600 text-white border-2 border-primary-600'
  }
  
  return 'bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-600 border-2 border-transparent hover:border-neutral-300 dark:hover:border-neutral-500'
}
</script>