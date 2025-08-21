<template>
  <div class="max-w-4xl mx-auto animate-bounce-in">
    <!-- Results Header -->
    <div class="text-center mb-8">
      <div class="inline-block p-4 rounded-full mb-4" :class="getScoreColorClass('bg')">
        <svg class="w-16 h-16" :class="getScoreColorClass('text')" fill="currentColor" viewBox="0 0 20 20">
          <path v-if="score >= 80" fill-rule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
          <path v-else-if="score >= 60" fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
          <path v-else fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
        </svg>
      </div>
      
      <h1 class="text-3xl lg:text-4xl font-bold text-neutral-800 dark:text-neutral-100 mb-2 chinese-text">
        測驗完成！
      </h1>
      
      <p class="text-lg text-neutral-600 dark:text-neutral-400 chinese-text">
        {{ getScoreMessage() }}
      </p>
    </div>
    
    <!-- Score Display -->
    <div class="quiz-card p-8 mb-6 text-center">
      <!-- Score Circle -->
      <div class="relative inline-block mb-6">
        <svg class="w-32 h-32 transform -rotate-90" viewBox="0 0 36 36">
          <!-- Background circle -->
          <path
            class="text-neutral-200 dark:text-neutral-700"
            stroke="currentColor"
            stroke-width="3"
            fill="none"
            d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831"
          />
          <!-- Progress circle -->
          <path
            :class="getScoreColorClass('text')"
            stroke="currentColor"
            stroke-width="3"
            fill="none"
            stroke-linecap="round"
            :stroke-dasharray="`${score}, 100`"
            d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831"
          />
        </svg>
        <div class="absolute inset-0 flex items-center justify-center">
          <span class="text-3xl font-bold" :class="getScoreColorClass('text')">
            {{ score }}%
          </span>
        </div>
      </div>
      
      <!-- Score Details -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div class="text-center">
          <div class="text-2xl font-bold text-success-600 dark:text-success-400">
            {{ correctAnswers }}
          </div>
          <div class="text-sm text-neutral-600 dark:text-neutral-400 chinese-text">
            正確答題
          </div>
        </div>
        
        <div class="text-center">
          <div class="text-2xl font-bold text-error-600 dark:text-error-400">
            {{ totalQuestions - correctAnswers }}
          </div>
          <div class="text-sm text-neutral-600 dark:text-neutral-400 chinese-text">
            錯誤答題
          </div>
        </div>
        
        <div class="text-center">
          <div class="text-2xl font-bold text-primary-600 dark:text-primary-400">
            {{ timeTaken || '--' }}
          </div>
          <div class="text-sm text-neutral-600 dark:text-neutral-400 chinese-text">
            {{ timeTaken ? '分鐘' : '測驗時間' }}
          </div>
        </div>
      </div>
    </div>
    
    <!-- Performance Analysis -->
    <div class="quiz-card p-6 mb-6">
      <h3 class="text-xl font-semibold text-neutral-800 dark:text-neutral-100 mb-4 chinese-text">
        成績分析
      </h3>
      
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Grade Level -->
        <div class="p-4 rounded-lg" :class="getScoreColorClass('bg-light')">
          <div class="flex items-center space-x-3">
            <div class="w-12 h-12 rounded-full flex items-center justify-center" :class="getScoreColorClass('bg')">
              <span class="text-xl font-bold" :class="getScoreColorClass('text')">
                {{ getGradeLevel() }}
              </span>
            </div>
            <div>
              <div class="font-semibold text-neutral-800 dark:text-neutral-100 chinese-text">
                成績等級
              </div>
              <div class="text-sm text-neutral-600 dark:text-neutral-400 chinese-text">
                {{ getGradeDescription() }}
              </div>
            </div>
          </div>
        </div>
        
        <!-- Certification Status -->
        <div class="p-4 rounded-lg" :class="score >= 70 ? 'bg-success-50 dark:bg-success-900/20' : 'bg-neutral-50 dark:bg-neutral-800'">
          <div class="flex items-center space-x-3">
            <div class="w-12 h-12 rounded-full flex items-center justify-center" :class="score >= 70 ? 'bg-success-100 dark:bg-success-900/30' : 'bg-neutral-200 dark:bg-neutral-700'">
              <svg class="w-6 h-6" :class="score >= 70 ? 'text-success-600 dark:text-success-400' : 'text-neutral-500 dark:text-neutral-400'" fill="currentColor" viewBox="0 0 20 20">
                <path v-if="score >= 70" fill-rule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                <path v-else fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
              </svg>
            </div>
            <div>
              <div class="font-semibold text-neutral-800 dark:text-neutral-100 chinese-text">
                {{ score >= 70 ? '恭喜通過' : '未達標準' }}
              </div>
              <div class="text-sm text-neutral-600 dark:text-neutral-400 chinese-text">
                {{ score >= 70 ? 'iPAS 淨零碳認證標準' : '需要 70 分以上' }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Action Buttons -->
    <div class="flex flex-col sm:flex-row gap-4 justify-center">
      <button
        @click="$emit('review-answers')"
        class="nav-button-secondary flex items-center justify-center space-x-2"
      >
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
          <path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/>
        </svg>
        <span class="chinese-text">檢視答案</span>
      </button>
      
      <button
        @click="$emit('restart-quiz')"
        class="nav-button-primary flex items-center justify-center space-x-2"
      >
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd"/>
        </svg>
        <span class="chinese-text">重新測驗</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  score: {
    type: Number,
    required: true
  },
  totalQuestions: {
    type: Number,
    required: true
  },
  correctAnswers: {
    type: Number,
    required: true
  },
  timeTaken: {
    type: Number,
    default: null
  },
  questions: {
    type: Array,
    required: true
  },
  selectedAnswers: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['restart-quiz', 'review-answers'])

const getScoreColorClass = (type) => {
  const score = props.score
  
  if (score >= 80) {
    return {
      'bg': 'bg-success-100 dark:bg-success-900/30',
      'bg-light': 'bg-success-50 dark:bg-success-900/20',
      'text': 'text-success-600 dark:text-success-400'
    }[type]
  } else if (score >= 60) {
    return {
      'bg': 'bg-warning-100 dark:bg-warning-900/30',
      'bg-light': 'bg-warning-50 dark:bg-warning-900/20',
      'text': 'text-warning-600 dark:text-warning-400'
    }[type]
  } else {
    return {
      'bg': 'bg-error-100 dark:bg-error-900/30',
      'bg-light': 'bg-error-50 dark:bg-error-900/20',
      'text': 'text-error-600 dark:text-error-400'
    }[type]
  }
}

const getGradeLevel = () => {
  const score = props.score
  if (score >= 90) return 'A+'
  if (score >= 80) return 'A'
  if (score >= 70) return 'B'
  if (score >= 60) return 'C'
  return 'D'
}

const getGradeDescription = () => {
  const score = props.score
  if (score >= 90) return '優異'
  if (score >= 80) return '良好'
  if (score >= 70) return '及格'
  if (score >= 60) return '待加強'
  return '需要重新學習'
}

const getScoreMessage = () => {
  const score = props.score
  if (score >= 90) return '表現優異！您對淨零碳概念有很好的掌握。'
  if (score >= 80) return '表現良好！您已具備基本的淨零碳知識。'
  if (score >= 70) return '恭喜通過測驗！建議持續學習相關知識。'
  if (score >= 60) return '接近及格標準，建議再次複習相關概念。'
  return '需要加強學習，建議詳細研讀相關資料後再次測驗。'
}
</script>