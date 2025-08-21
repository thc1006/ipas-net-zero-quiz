<template>
  <div class="optimized-quiz-view">
    <!-- Performance Monitor (dev only) -->
    <PerformanceMonitor v-if="isDev" class="performance-monitor" />
    
    <!-- Loading State -->
    <div v-if="isLoading" class="loading-container">
      <LoadingSpinner />
      <p class="loading-text">載入題目中... ({{ loadingProgress }}%)</p>
    </div>
    
    <!-- Error State -->
    <div v-else-if="error" class="error-container">
      <ErrorState 
        :error="error" 
        @retry="loadQuestions" 
      />
    </div>
    
    <!-- Quiz Interface -->
    <div v-else-if="questions.length > 0" class="quiz-interface">
      <!-- Quiz Header with Progress -->
      <QuizHeader
        :current-question-number="currentQuestionNumber"
        :total-questions="totalQuestions"
        :score="score"
        :timer="formattedTime"
        :subject="currentQuestion?.subject"
      />
      
      <!-- Main Quiz Content -->
      <div class="quiz-content">
        <!-- Question Display with Virtual Scrolling for Long Questions -->
        <div class="question-section">
          <QuizQuestion
            :question="currentQuestion"
            :user-answer="currentQuestionAnswer"
            :is-answered="isCurrentQuestionAnswered"
            :show-feedback="showFeedback"
            @answer="handleAnswer"
          />
        </div>
        
        <!-- Progress Bar -->
        <QuizProgress
          :progress="progressPercentage"
          :current="currentQuestionNumber"
          :total="totalQuestions"
          class="progress-section"
        />
        
        <!-- Navigation Controls -->
        <QuizNavigation
          :can-go-previous="canGoPrevious"
          :can-go-next="canGoNext"
          :is-quiz-completed="isQuizCompleted"
          :current-question-answered="isCurrentQuestionAnswered"
          @previous="previousQuestion"
          @next="nextQuestion"
          @complete="completeQuiz"
          class="navigation-section"
        />
      </div>
    </div>
    
    <!-- Quiz Results with Virtual Scrolling -->
    <QuizResults
      v-if="isQuizCompleted && showResults"
      :results="quizResults"
      :statistics="statistics"
      @restart="restartQuiz"
      @review="enterReviewMode"
      class="results-section"
    />
    
    <!-- Question Navigation Overlay (for large question sets) -->
    <QuestionNavOverlay
      v-if="showNavigationOverlay"
      :questions="questions"
      :current-index="currentQuestionIndex"
      :user-answers="userAnswers"
      @goto="goToQuestion"
      @close="showNavigationOverlay = false"
    />
    
    <!-- Settings Panel -->
    <QuizSettings
      v-if="showSettings"
      :settings="quizSettings"
      @update="updateSettings"
      @close="showSettings = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useQuestionLoader } from '@data/question-loader.js'
import { useQuiz } from '@composables/useQuiz.js'
import { 
  performanceMonitor, 
  trackComponentPerformance, 
  memoryManager 
} from '@utils/performance.js'

// Lazy load components for better performance
const LoadingSpinner = defineAsyncComponent(() => import('./LoadingSpinner.vue'))
const ErrorState = defineAsyncComponent(() => import('./ErrorState.vue'))
const QuizHeader = defineAsyncComponent(() => import('./QuizHeader.vue'))
const QuizQuestion = defineAsyncComponent(() => import('./QuizQuestion.vue'))
const QuizProgress = defineAsyncComponent(() => import('./QuizProgress.vue'))
const QuizNavigation = defineAsyncComponent(() => import('./QuizNavigation.vue'))
const QuizResults = defineAsyncComponent(() => import('./QuizResults.vue'))
const PerformanceMonitor = defineAsyncComponent(() => import('./PerformanceMonitor.vue'))

// Lazy load heavy components only when needed
const QuestionNavOverlay = defineAsyncComponent(() => import('./QuestionNavOverlay.vue'))
const QuizSettings = defineAsyncComponent(() => import('./QuizSettings.vue'))

// Props
const props = defineProps({
  subject: {
    type: String,
    default: null
  },
  questionLimit: {
    type: Number,
    default: null
  },
  autoStart: {
    type: Boolean,
    default: false
  }
})

// Environment check
const isDev = import.meta.env.DEV

// Question loading composable
const {
  isLoading,
  error,
  questions,
  loadQuestions,
  preloadNext,
  getCacheStats
} = useQuestionLoader()

// Quiz state management
const quiz = useQuiz()
const {
  // State
  currentQuestion,
  currentQuestionIndex,
  currentQuestionNumber,
  totalQuestions,
  isQuizStarted,
  isQuizCompleted,
  isReviewMode,
  userAnswers,
  
  // Configuration
  timePerQuestion,
  isTimerEnabled,
  
  // Timer
  formattedTime,
  
  // Computed
  progressPercentage,
  score,
  canGoNext,
  canGoPrevious,
  currentQuestionAnswer,
  isCurrentQuestionAnswered,
  
  // Statistics
  statistics,
  
  // Methods
  initializeQuiz,
  startQuiz,
  answerQuestion,
  nextQuestion,
  previousQuestion,
  goToQuestion,
  completeQuiz,
  resetQuiz,
  enterReviewMode,
  getResults
} = quiz

// Component state
const showFeedback = ref(false)
const showResults = ref(false)
const showNavigationOverlay = ref(false)
const showSettings = ref(false)
const loadingProgress = ref(0)
const quizResults = ref(null)
const quizSettings = ref({
  shuffleQuestions: false,
  shuffleOptions: false,
  timePerQuestion: 60,
  isTimerEnabled: true,
  subject: props.subject
})

// Performance tracking
let componentTracker = null
let memoryCleanupTask = null

// Load questions on component mount
onMounted(async () => {
  componentTracker = trackComponentPerformance('OptimizedQuizView', 'mount')
  
  try {
    await loadInitialQuestions()
    
    if (props.autoStart) {
      await initializeAndStartQuiz()
    }
    
    // Register memory cleanup
    memoryCleanupTask = () => {
      // Clean up unused cached data
      if (questions.value.length > 100) {
        // Keep only current and nearby questions in memory
        const keepRange = 20
        const start = Math.max(0, currentQuestionIndex.value - keepRange)
        const end = Math.min(questions.value.length, currentQuestionIndex.value + keepRange)
        
        // This would be implemented in the question loader
        console.log(`Keeping questions ${start}-${end} in memory`)
      }
    }
    
    memoryManager.registerCleanup(memoryCleanupTask, 60000) // Every minute
    
  } catch (err) {
    console.error('Failed to initialize quiz:', err)
    error.value = err.message
  } finally {
    componentTracker?.end()
  }
})

// Cleanup on unmount
onUnmounted(() => {
  if (memoryCleanupTask) {
    memoryManager.unregisterCleanup(memoryCleanupTask)
  }
  
  // Record component lifecycle metric
  performanceMonitor.recordMetric('component.OptimizedQuizView.unmount', Date.now())
})

// Watch for question changes to preload next chunk
watch(currentQuestionIndex, (newIndex) => {
  if (newIndex >= 0 && questions.value[newIndex]) {
    preloadNext(questions.value[newIndex].id)
  }
})

// Watch for quiz completion
watch(isQuizCompleted, (completed) => {
  if (completed) {
    showQuizResults()
  }
})

// Methods
const loadInitialQuestions = async () => {
  const tracker = trackComponentPerformance('OptimizedQuizView', 'loadQuestions')
  
  try {
    loadingProgress.value = 0
    
    // Simulate loading progress for better UX
    const progressInterval = setInterval(() => {
      loadingProgress.value = Math.min(90, loadingProgress.value + 10)
    }, 100)
    
    const loadedQuestions = await loadQuestions(props.subject, props.questionLimit)
    
    clearInterval(progressInterval)
    loadingProgress.value = 100
    
    if (loadedQuestions.length === 0) {
      throw new Error('沒有找到符合條件的題目')
    }
    
    tracker.end({ questionsLoaded: loadedQuestions.length })
    
    // Wait a bit for better UX
    await new Promise(resolve => setTimeout(resolve, 200))
    
  } catch (err) {
    tracker.end({ error: err.message })
    throw err
  }
}

const initializeAndStartQuiz = async () => {
  const tracker = trackComponentPerformance('OptimizedQuizView', 'initializeQuiz')
  
  try {
    // Initialize quiz with settings
    initializeQuiz(quizSettings.value)
    
    // Start quiz
    startQuiz()
    
    tracker.end()
    
  } catch (err) {
    tracker.end({ error: err.message })
    throw err
  }
}

const handleAnswer = async (selectedOption) => {
  const tracker = trackComponentPerformance('OptimizedQuizView', 'handleAnswer')
  
  try {
    // Show immediate feedback
    showFeedback.value = true
    
    // Record answer
    answerQuestion(selectedOption)
    
    // Auto-advance after feedback delay
    await new Promise(resolve => setTimeout(resolve, 1500))
    
    showFeedback.value = false
    
    tracker.end({ option: selectedOption })
    
  } catch (err) {
    tracker.end({ error: err.message })
    console.error('Error handling answer:', err)
  }
}

const showQuizResults = async () => {
  const tracker = trackComponentPerformance('OptimizedQuizView', 'showResults')
  
  try {
    quizResults.value = getResults()
    showResults.value = true
    
    // Record completion metrics
    performanceMonitor.recordMetric('quiz.completed', {
      totalQuestions: totalQuestions.value,
      score: score.value.percentage,
      timeSpent: statistics.totalTimeSpent
    })
    
    tracker.end()
    
  } catch (err) {
    tracker.end({ error: err.message })
    console.error('Error showing results:', err)
  }
}

const restartQuiz = async () => {
  const tracker = trackComponentPerformance('OptimizedQuizView', 'restart')
  
  try {
    // Reset quiz state
    resetQuiz()
    showResults.value = false
    showFeedback.value = false
    
    // Reload questions if needed
    await loadInitialQuestions()
    
    // Reinitialize and start
    await initializeAndStartQuiz()
    
    tracker.end()
    
  } catch (err) {
    tracker.end({ error: err.message })
    console.error('Error restarting quiz:', err)
  }
}

const updateSettings = (newSettings) => {
  const tracker = trackComponentPerformance('OptimizedQuizView', 'updateSettings')
  
  try {
    quizSettings.value = { ...quizSettings.value, ...newSettings }
    
    // Reinitialize quiz with new settings
    if (questions.value.length > 0) {
      initializeQuiz(quizSettings.value)
    }
    
    tracker.end()
    
  } catch (err) {
    tracker.end({ error: err.message })
    console.error('Error updating settings:', err)
  }
}

const toggleNavigationOverlay = () => {
  showNavigationOverlay.value = !showNavigationOverlay.value
}

const toggleSettings = () => {
  showSettings.value = !showSettings.value
}

// Expose methods for parent components
defineExpose({
  loadQuestions: loadInitialQuestions,
  startQuiz: initializeAndStartQuiz,
  resetQuiz,
  getCacheStats,
  toggleNavigationOverlay,
  toggleSettings
})
</script>

<style scoped>
.optimized-quiz-view {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  position: relative;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.performance-monitor {
  position: fixed;
  top: 10px;
  right: 10px;
  z-index: 1000;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  text-align: center;
}

.loading-text {
  margin-top: 1rem;
  color: white;
  font-size: 1.1rem;
}

.error-container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
}

.quiz-interface {
  display: flex;
  flex-direction: column;
  flex: 1;
  max-width: 900px;
  margin: 0 auto;
  padding: 1rem;
  gap: 1.5rem;
}

.quiz-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  flex: 1;
}

.question-section {
  flex: 1;
}

.progress-section {
  flex-shrink: 0;
}

.navigation-section {
  flex-shrink: 0;
}

.results-section {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Responsive design */
@media (max-width: 768px) {
  .quiz-interface {
    padding: 0.5rem;
    gap: 1rem;
  }
  
  .quiz-content {
    gap: 1rem;
  }
}

/* Performance optimizations */
.quiz-interface {
  contain: layout style;
  will-change: transform;
}

.question-section {
  contain: layout;
}

/* Animations with hardware acceleration */
.quiz-content {
  transition: opacity 0.3s ease;
}

.quiz-content.loading {
  opacity: 0.7;
}

/* Loading states */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.loading-container {
  animation: pulse 2s ease-in-out infinite;
}
</style>