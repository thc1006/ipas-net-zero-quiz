<template>
  <div class="max-w-4xl mx-auto animate-fade-in">
    <!-- Question Card -->
    <div class="quiz-card p-6 lg:p-8 mb-6">
      <!-- Question Header -->
      <div class="mb-6">
        <div class="flex items-start justify-between mb-4">
          <span class="inline-block px-3 py-1 bg-primary-100 dark:bg-primary-900/30 text-primary-800 dark:text-primary-200 rounded-full text-sm font-medium">
            第 {{ questionNumber }} 題
          </span>
          <div class="text-right">
            <div v-if="question.subject" class="text-xs text-neutral-500 dark:text-neutral-400 mb-1 chinese-text">
              {{ question.subject }}
            </div>
            <div v-if="question.id" class="text-xs text-neutral-400 dark:text-neutral-500 font-mono">
              {{ question.id }}
            </div>
          </div>
        </div>
        
        <!-- Question Text -->
        <h2 class="text-xl lg:text-2xl font-semibold text-neutral-800 dark:text-neutral-100 leading-relaxed chinese-text">
          {{ question.question }}
        </h2>
      </div>
      
      <!-- Options -->
      <div class="space-y-3">
        <button
          v-for="(optionText, optionKey) in question.options"
          :key="optionKey"
          @click="selectAnswer(optionKey)"
          :disabled="isSubmitted"
          class="option-button group"
          :class="getOptionClass(optionKey)"
          :aria-pressed="selectedAnswer === optionKey"
          :aria-describedby="showFeedback ? `explanation-${optionKey}` : null"
        >
          <div class="flex items-start space-x-4">
            <!-- Option Letter -->
            <div 
              class="flex-shrink-0 w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold text-sm transition-all duration-200"
              :class="getOptionLetterClass(optionKey)"
            >
              {{ optionKey }}
            </div>
            
            <!-- Option Text -->
            <div class="flex-1 text-left chinese-text">
              {{ optionText }}
            </div>
            
            <!-- Status Icon -->
            <div v-if="showFeedback && getStatusIcon(optionKey)" class="flex-shrink-0">
              <div 
                class="w-6 h-6 rounded-full flex items-center justify-center"
                :class="getStatusIconClass(optionKey)"
              >
                <svg 
                  v-if="getStatusIcon(optionKey) === 'correct'"
                  class="w-4 h-4"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
                <svg 
                  v-else-if="getStatusIcon(optionKey) === 'incorrect'"
                  class="w-4 h-4"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                </svg>
              </div>
            </div>
          </div>
        </button>
      </div>
      
      <!-- Selection Indicator -->
      <div v-if="selectedAnswer && !showFeedback" class="mt-4 text-center">
        <p class="text-sm text-primary-600 dark:text-primary-400 font-medium chinese-text">
          已選擇答案 {{ selectedAnswer }}
        </p>
      </div>
    </div>
    
    <!-- Explanation (shown after submission) -->
    <Transition name="slide-in">
      <div 
        v-if="showFeedback && question.explanation"
        class="quiz-card p-6 bg-neutral-50 dark:bg-neutral-800/50 border-l-4 border-primary-500"
      >
        <div class="flex items-start space-x-3">
          <div class="flex-shrink-0">
            <div class="w-8 h-8 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center">
              <svg class="w-4 h-4 text-primary-600 dark:text-primary-400" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
              </svg>
            </div>
          </div>
          <div class="flex-1">
            <h3 class="font-semibold text-neutral-800 dark:text-neutral-100 mb-2 chinese-text">
              解析說明
            </h3>
            <p class="text-neutral-700 dark:text-neutral-300 leading-relaxed chinese-text">
              {{ question.explanation }}
            </p>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  question: {
    type: Object,
    required: true
  },
  questionNumber: {
    type: Number,
    required: true
  },
  selectedAnswer: {
    type: String,
    default: null
  },
  showFeedback: {
    type: Boolean,
    default: false
  },
  isSubmitted: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['answer-selected'])

const selectAnswer = (optionKey) => {
  if (!props.isSubmitted) {
    emit('answer-selected', optionKey)
  }
}

const getOptionClass = (optionKey) => {
  const classes = []
  
  if (props.selectedAnswer === optionKey) {
    classes.push('selected')
  }
  
  if (props.showFeedback) {
    if (optionKey === props.question.answer) {
      classes.push('correct')
    } else if (props.selectedAnswer === optionKey && optionKey !== props.question.answer) {
      classes.push('incorrect')
    }
  }
  
  return classes
}

const getOptionLetterClass = (optionKey) => {
  if (props.showFeedback) {
    if (optionKey === props.question.answer) {
      return 'border-success-500 bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-300'
    } else if (props.selectedAnswer === optionKey && optionKey !== props.question.answer) {
      return 'border-error-500 bg-error-100 dark:bg-error-900/30 text-error-700 dark:text-error-300'
    }
  }
  
  if (props.selectedAnswer === optionKey) {
    return 'border-primary-500 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
  }
  
  return 'border-neutral-300 dark:border-neutral-600 text-neutral-600 dark:text-neutral-400 group-hover:border-primary-300 group-hover:text-primary-600'
}

const getStatusIcon = (optionKey) => {
  if (!props.showFeedback) return null
  
  if (optionKey === props.question.answer) {
    return 'correct'
  } else if (props.selectedAnswer === optionKey && optionKey !== props.question.answer) {
    return 'incorrect'
  }
  
  return null
}

const getStatusIconClass = (optionKey) => {
  if (optionKey === props.question.answer) {
    return 'bg-success-500 text-white'
  } else if (props.selectedAnswer === optionKey && optionKey !== props.question.answer) {
    return 'bg-error-500 text-white'
  }
  return ''
}
</script>"}