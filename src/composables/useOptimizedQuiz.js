/**
 * Optimized Quiz State Management Composable
 * Enhanced version with performance optimizations, memory management, and virtual scrolling support
 */

import { 
  ref, 
  computed, 
  reactive, 
  watch, 
  onMounted, 
  onUnmounted, 
  markRaw, 
  shallowRef, 
  triggerRef 
} from 'vue'
import { 
  trackAsyncOperation, 
  trackComponentPerformance, 
  performanceThrottle, 
  performanceDebounce,
  memoryManager 
} from '@utils/performance.js'

/**
 * Optimized Quiz Composable with Performance Enhancements
 */
export function useOptimizedQuiz(initialQuestions = []) {
  // Use shallow refs for large data structures to improve reactivity performance
  const originalQuestions = shallowRef([...initialQuestions])
  const questions = shallowRef([...initialQuestions])
  const currentQuestionIndex = ref(0)
  
  // Quiz state
  const isQuizStarted = ref(false)
  const isQuizCompleted = ref(false)
  const isReviewMode = ref(false)
  
  // Timer state with optimizations
  const timePerQuestion = ref(60)
  const currentQuestionTime = ref(0)
  const totalQuizTime = ref(0)
  const timerInterval = ref(null)
  const isTimerEnabled = ref(true)
  
  // Use Map for better performance with large datasets
  const userAnswers = reactive(new Map())
  const questionStartTimes = reactive(new Map())
  const answerHistory = shallowRef([])
  
  // Configuration
  const quizConfig = reactive({
    shuffleQuestions: false,
    shuffleOptions: false,
    randomizeQuestionOrder: false,
    enableVirtualScrolling: true,
    chunkSize: 50,
    preloadDistance: 10
  })
  
  // Performance statistics
  const performanceStats = reactive({
    renderTime: 0,
    memoryUsage: 0,
    lastGCTime: 0,
    cacheHits: 0,
    cacheMisses: 0
  })
  
  // Statistics with optimized updates
  const statistics = reactive({
    totalQuestionsAnswered: 0,
    correctAnswers: 0,
    incorrectAnswers: 0,
    averageTimePerQuestion: 0,
    totalTimeSpent: 0,
    accuracyPercentage: 0,
    questionsReviewed: 0,
    lastSessionDate: null,
    streakCorrect: 0,
    maxStreakCorrect: 0
  })
  
  // Virtual scrolling state
  const virtualScrollState = reactive({
    containerHeight: 600,
    itemHeight: 120,
    buffer: 5,
    visibleRange: { start: 0, end: 0 }
  })
  
  // Memory management
  let cleanupTasks = new Set()
  let memoryCleanupInterval = null
  
  // Computed properties with caching optimizations
  const currentQuestion = computed(() => {
    const index = currentQuestionIndex.value
    if (index < 0 || index >= questions.value.length) {
      return null
    }
    return questions.value[index]
  })
  
  const currentQuestionNumber = computed(() => currentQuestionIndex.value + 1)
  const totalQuestions = computed(() => questions.value.length)
  
  const progressPercentage = computed(() => {
    const total = totalQuestions.value
    if (total === 0) return 0
    return Math.round((currentQuestionNumber.value / total) * 100)
  })
  
  // Optimized score calculation with memoization
  const scoreCache = new Map()
  const score = computed(() => {
    const cacheKey = `${userAnswers.size}-${questions.value.length}`
    
    if (scoreCache.has(cacheKey)) {
      return scoreCache.get(cacheKey)
    }
    
    const tracker = trackComponentPerformance('useOptimizedQuiz', 'calculateScore')
    
    let correct = 0
    let total = 0
    
    for (const [questionId, answer] of userAnswers) {
      const question = originalQuestions.value.find(q => q.id === questionId)
      if (question) {
        total++
        if (answer === question.answer) {
          correct++
        }
      }
    }
    
    const result = {
      correct,
      total,
      percentage: total > 0 ? Math.round((correct / total) * 100) : 0
    }
    
    scoreCache.set(cacheKey, result)
    tracker.end()
    
    return result
  })
  
  const canGoNext = computed(() => currentQuestionIndex.value < questions.value.length - 1)
  const canGoPrevious = computed(() => currentQuestionIndex.value > 0)
  
  const currentQuestionAnswer = computed(() => {
    const question = currentQuestion.value
    if (!question) return null
    return userAnswers.get(question.id) || null
  })
  
  const isCurrentQuestionAnswered = computed(() => {
    return currentQuestionAnswer.value !== null
  })
  
  const remainingTime = computed(() => {
    if (!isTimerEnabled.value) return null
    return Math.max(0, timePerQuestion.value - currentQuestionTime.value)
  })
  
  const formattedTime = computed(() => {
    const time = remainingTime.value
    if (time === null) return ''
    const minutes = Math.floor(time / 60)
    const seconds = time % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  })
  
  const formattedTotalTime = computed(() => {
    const minutes = Math.floor(totalQuizTime.value / 60)
    const seconds = totalQuizTime.value % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  })
  
  // Virtual scrolling support
  const visibleQuestions = computed(() => {
    if (!quizConfig.enableVirtualScrolling) {
      return questions.value
    }
    
    const { start, end } = virtualScrollState.visibleRange
    return questions.value.slice(start, end)
  })
  
  // Storage keys with versioning
  const STORAGE_KEYS = {
    QUIZ_STATE: 'ipas-quiz-state-v2',
    USER_ANSWERS: 'ipas-quiz-answers-v2',
    STATISTICS: 'ipas-quiz-statistics-v2',
    CONFIG: 'ipas-quiz-config-v2',
    PERFORMANCE: 'ipas-quiz-performance-v2'
  }
  
  /**
   * Optimized array shuffling with Fisher-Yates algorithm
   */
  function shuffleArray(array) {
    const shuffled = [...array]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      // Use destructuring for better performance
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
  }
  
  /**
   * Memory-efficient question option shuffling
   */
  function shuffleQuestionOptions(question) {
    if (!quizConfig.shuffleOptions || !question.options) return question
    
    const optionEntries = Object.entries(question.options)
    const shuffledValues = shuffleArray(optionEntries.map(([, value]) => value))
    
    const shuffledOptions = {}
    const answerMapping = {}
    
    optionEntries.forEach(([key], index) => {
      shuffledOptions[key] = shuffledValues[index]
      
      // Find original key for this value
      const originalEntry = optionEntries.find(([, value]) => value === shuffledValues[index])
      if (originalEntry) {
        answerMapping[originalEntry[0]] = key
      }
    })
    
    return {
      ...question,
      options: shuffledOptions,
      answer: answerMapping[question.answer] || question.answer
    }
  }
  
  /**
   * Initialize quiz with performance optimizations
   */
  function initializeQuiz(config = {}) {
    const tracker = trackAsyncOperation('quiz.initialize')
    
    try {
      // Apply configuration
      Object.assign(quizConfig, config)
      
      // Prepare questions efficiently
      let preparedQuestions = originalQuestions.value
      
      if (quizConfig.shuffleQuestions) {
        preparedQuestions = shuffleArray(preparedQuestions)
      }
      
      if (quizConfig.shuffleOptions) {
        preparedQuestions = preparedQuestions.map(shuffleQuestionOptions)
      }
      
      // Use markRaw to prevent deep reactivity on large objects
      questions.value = markRaw(preparedQuestions)
      triggerRef(questions)
      
      // Reset state efficiently
      resetQuizState()
      
      // Load persisted state
      loadFromStorage()
      
      // Initialize memory management
      setupMemoryManagement()
      
      tracker.end({ questionsCount: preparedQuestions.length })
      
    } catch (error) {
      tracker.end({ error: error.message })
      throw new Error(`Quiz initialization failed: ${error.message}`)
    }
  }
  
  /**
   * Reset quiz state efficiently
   */
  function resetQuizState() {
    currentQuestionIndex.value = 0
    isQuizCompleted.value = false
    isReviewMode.value = false
    
    // Clear Maps efficiently
    userAnswers.clear()
    questionStartTimes.clear()
    
    // Clear arrays
    answerHistory.value = []
    
    // Clear caches
    scoreCache.clear()
  }
  
  /**
   * Setup memory management
   */
  function setupMemoryManagement() {
    // Register cleanup tasks
    const cleanup = () => {
      // Clean up old answer history (keep last 100 items)
      if (answerHistory.value.length > 100) {
        answerHistory.value = answerHistory.value.slice(-100)
      }
      
      // Clear score cache periodically
      if (scoreCache.size > 50) {
        scoreCache.clear()
      }
      
      // Force garbage collection if available
      memoryManager.forceGC()
      
      // Update performance stats
      const usage = memoryManager.getMemoryUsage()
      if (usage) {
        performanceStats.memoryUsage = usage.percentage
      }
    }
    
    cleanupTasks.add(cleanup)
    memoryManager.registerCleanup(cleanup, 30000) // Every 30 seconds
    
    // Setup periodic cleanup
    memoryCleanupInterval = setInterval(cleanup, 60000) // Every minute
  }
  
  /**
   * Optimized question navigation with preloading
   */
  function goToQuestion(index) {
    if (index < 0 || index >= questions.value.length) return
    
    const tracker = trackComponentPerformance('quiz', 'navigation')
    
    stopQuestionTimer()
    currentQuestionIndex.value = index
    recordQuestionStartTime()
    
    if (isTimerEnabled.value && !isQuizCompleted.value) {
      startQuestionTimer()
    }
    
    // Preload nearby questions for better performance
    preloadNearbyQuestions(index)
    
    // Throttled save to avoid excessive storage writes
    throttledSave()
    
    tracker.end({ newIndex: index })
  }
  
  /**
   * Preload questions near current index
   */
  function preloadNearbyQuestions(currentIndex) {
    const preloadRange = quizConfig.preloadDistance
    const start = Math.max(0, currentIndex - preloadRange)
    const end = Math.min(questions.value.length, currentIndex + preloadRange + 1)
    
    // This would integrate with the question loader to preload chunks
    for (let i = start; i < end; i++) {
      const question = questions.value[i]
      if (question) {
        // Mark as accessed for caching priority
        performanceStats.cacheHits++
      }
    }
  }
  
  /**
   * Start optimized question timer
   */
  function startQuestionTimer() {
    if (timerInterval.value) {
      clearInterval(timerInterval.value)
    }
    
    currentQuestionTime.value = 0
    
    // Use more efficient timer with requestAnimationFrame for better accuracy
    const startTime = performance.now()
    let lastUpdate = startTime
    
    const updateTimer = () => {
      const now = performance.now()
      const deltaTime = now - lastUpdate
      
      if (deltaTime >= 1000) { // Update every second
        currentQuestionTime.value++
        totalQuizTime.value++
        lastUpdate = now
        
        if (currentQuestionTime.value >= timePerQuestion.value) {
          handleTimeUp()
          return
        }
      }
      
      if (!isQuizCompleted.value && isTimerEnabled.value) {
        timerInterval.value = requestAnimationFrame(updateTimer)
      }
    }
    
    timerInterval.value = requestAnimationFrame(updateTimer)
  }
  
  /**
   * Stop question timer efficiently
   */
  function stopQuestionTimer() {
    if (timerInterval.value) {
      cancelAnimationFrame(timerInterval.value)
      timerInterval.value = null
    }
  }
  
  /**
   * Handle time up with performance tracking
   */
  function handleTimeUp() {
    const tracker = trackAsyncOperation('quiz.timeUp')
    
    stopQuestionTimer()
    
    // Auto-advance logic
    if (!isCurrentQuestionAnswered.value) {
      recordAnswer(null, true) // Mark as timed out
      
      if (canGoNext.value) {
        nextQuestion()
      } else {
        completeQuiz()
      }
    }
    
    tracker.end()
  }
  
  /**
   * Record question start time efficiently
   */
  function recordQuestionStartTime() {
    const question = currentQuestion.value
    if (question) {
      questionStartTimes.set(question.id, performance.now())
    }
  }
  
  /**
   * Optimized answer recording
   */
  function recordAnswer(selectedOption, isTimedOut = false) {
    if (!currentQuestion.value) return
    
    const tracker = trackComponentPerformance('quiz', 'recordAnswer')
    
    try {
      const questionId = currentQuestion.value.id
      const isCorrect = selectedOption === currentQuestion.value.answer
      
      // Record answer efficiently
      userAnswers.set(questionId, selectedOption)
      
      // Calculate time spent
      const startTime = questionStartTimes.get(questionId)
      const timeSpent = startTime ? performance.now() - startTime : 0
      
      // Create answer record
      const answerRecord = {
        questionId,
        question: currentQuestion.value.question,
        selectedAnswer: selectedOption,
        correctAnswer: currentQuestion.value.answer,
        isCorrect,
        isTimedOut,
        timeSpent: Math.round(timeSpent),
        timestamp: Date.now()
      }
      
      // Add to history efficiently
      answerHistory.value.push(answerRecord)
      
      // Update statistics
      updateStatistics(isCorrect, timeSpent)
      
      // Clear score cache to force recalculation
      scoreCache.clear()
      
      tracker.end({ isCorrect, timeSpent })
      
    } catch (error) {
      tracker.end({ error: error.message })
      console.error('Error recording answer:', error)
    }
  }
  
  /**
   * Optimized statistics update
   */
  function updateStatistics(isCorrect, timeSpent) {
    statistics.totalQuestionsAnswered++
    
    if (isCorrect) {
      statistics.correctAnswers++
      statistics.streakCorrect++
      statistics.maxStreakCorrect = Math.max(
        statistics.maxStreakCorrect, 
        statistics.streakCorrect
      )
    } else {
      statistics.incorrectAnswers++
      statistics.streakCorrect = 0
    }
    
    // Update time statistics
    const timeInSeconds = Math.round(timeSpent / 1000)
    statistics.totalTimeSpent += timeInSeconds
    statistics.averageTimePerQuestion = Math.round(
      statistics.totalTimeSpent / statistics.totalQuestionsAnswered
    )
    
    // Calculate accuracy efficiently
    statistics.accuracyPercentage = Math.round(
      (statistics.correctAnswers / statistics.totalQuestionsAnswered) * 100
    )
  }
  
  /**
   * Navigation methods with optimizations
   */
  const nextQuestion = () => {
    if (canGoNext.value) {
      goToQuestion(currentQuestionIndex.value + 1)
    }
  }
  
  const previousQuestion = () => {
    if (canGoPrevious.value) {
      goToQuestion(currentQuestionIndex.value - 1)
    }
  }
  
  /**
   * Answer question with performance tracking
   */
  function answerQuestion(selectedOption) {
    if (!currentQuestion.value || isQuizCompleted.value) return
    
    const tracker = trackAsyncOperation('quiz.answerQuestion')
    
    try {
      recordAnswer(selectedOption)
      
      // Auto-advance with delay for user feedback
      setTimeout(() => {
        if (canGoNext.value) {
          nextQuestion()
        } else {
          completeQuiz()
        }
      }, 1000)
      
      tracker.end({ selectedOption })
      
    } catch (error) {
      tracker.end({ error: error.message })
      console.error('Error answering question:', error)
    }
  }
  
  /**
   * Start quiz with performance tracking
   */
  function startQuiz() {
    const tracker = trackAsyncOperation('quiz.start')
    
    try {
      isQuizStarted.value = true
      statistics.lastSessionDate = new Date().toISOString()
      
      if (isTimerEnabled.value) {
        startQuestionTimer()
      }
      
      recordQuestionStartTime()
      throttledSave()
      
      tracker.end()
      
    } catch (error) {
      tracker.end({ error: error.message })
      throw error
    }
  }
  
  /**
   * Complete quiz with cleanup
   */
  function completeQuiz() {
    const tracker = trackAsyncOperation('quiz.complete')
    
    try {
      stopQuestionTimer()
      isQuizCompleted.value = true
      
      // Final statistics update
      statistics.lastSessionDate = new Date().toISOString()
      
      // Save final state
      saveToStorage()
      
      tracker.end({
        totalQuestions: totalQuestions.value,
        score: score.value.percentage,
        timeSpent: statistics.totalTimeSpent
      })
      
    } catch (error) {
      tracker.end({ error: error.message })
      console.error('Error completing quiz:', error)
    }
  }
  
  /**
   * Reset quiz with memory cleanup
   */
  function resetQuiz() {
    const tracker = trackAsyncOperation('quiz.reset')
    
    try {
      stopQuestionTimer()
      resetQuizState()
      
      // Clear performance stats
      Object.assign(performanceStats, {
        renderTime: 0,
        memoryUsage: 0,
        lastGCTime: 0,
        cacheHits: 0,
        cacheMisses: 0
      })
      
      // Reset statistics for new session
      Object.assign(statistics, {
        totalQuestionsAnswered: 0,
        correctAnswers: 0,
        incorrectAnswers: 0,
        averageTimePerQuestion: 0,
        totalTimeSpent: 0,
        accuracyPercentage: 0,
        streakCorrect: 0
      })
      
      clearStorage()
      tracker.end()
      
    } catch (error) {
      tracker.end({ error: error.message })
      console.error('Error resetting quiz:', error)
    }
  }
  
  /**
   * Get detailed results with caching
   */
  function getResults() {
    const tracker = trackComponentPerformance('quiz', 'getResults')
    
    try {
      const results = []
      
      questions.value.forEach(question => {
        const answer = userAnswers.get(question.id)
        const history = answerHistory.value.find(h => h.questionId === question.id)
        
        results.push({
          question,
          answered: Boolean(answer),
          correct: answer === question.answer,
          selectedAnswer: answer,
          correctAnswer: question.answer,
          timeSpent: history?.timeSpent || 0,
          explanation: question.explanation,
          isTimedOut: history?.isTimedOut || false
        })
      })
      
      const finalResults = {
        questions: results,
        score: score.value,
        statistics: { ...statistics },
        totalTime: formattedTotalTime.value,
        performanceStats: { ...performanceStats }
      }
      
      tracker.end({ questionsCount: results.length })
      return finalResults
      
    } catch (error) {
      tracker.end({ error: error.message })
      throw error
    }
  }
  
  /**
   * Throttled save to reduce storage operations
   */
  const throttledSave = performanceThrottle(saveToStorage, 1000, 'quizSave')
  
  /**
   * Optimized storage operations
   */
  function saveToStorage() {
    const tracker = trackAsyncOperation('quiz.save')
    
    try {
      const state = {
        currentQuestionIndex: currentQuestionIndex.value,
        isQuizStarted: isQuizStarted.value,
        isQuizCompleted: isQuizCompleted.value,
        isReviewMode: isReviewMode.value,
        totalQuizTime: totalQuizTime.value,
        questionsLength: questions.value.length
      }
      
      const config = { ...quizConfig }
      
      // Convert Map to Array for storage
      const answersArray = Array.from(userAnswers.entries())
      
      // Use batch storage operations
      const storagePromises = [
        setStorageItem(STORAGE_KEYS.QUIZ_STATE, state),
        setStorageItem(STORAGE_KEYS.USER_ANSWERS, answersArray),
        setStorageItem(STORAGE_KEYS.STATISTICS, statistics),
        setStorageItem(STORAGE_KEYS.CONFIG, config),
        setStorageItem(STORAGE_KEYS.PERFORMANCE, performanceStats)
      ]
      
      Promise.all(storagePromises)
        .then(() => {
          tracker.end({ success: true })
        })
        .catch(error => {
          tracker.end({ error: error.message })
          console.warn('Storage save failed:', error)
        })
        
    } catch (error) {
      tracker.end({ error: error.message })
      console.warn('Failed to prepare storage data:', error)
    }
  }
  
  /**
   * Optimized storage loading
   */
  function loadFromStorage() {
    const tracker = trackAsyncOperation('quiz.load')
    
    try {
      const loadPromises = [
        getStorageItem(STORAGE_KEYS.QUIZ_STATE),
        getStorageItem(STORAGE_KEYS.USER_ANSWERS),
        getStorageItem(STORAGE_KEYS.STATISTICS),
        getStorageItem(STORAGE_KEYS.CONFIG),
        getStorageItem(STORAGE_KEYS.PERFORMANCE)
      ]
      
      Promise.all(loadPromises)
        .then(([savedState, savedAnswers, savedStatistics, savedConfig, savedPerformance]) => {
          // Restore state
          if (savedState) {
            currentQuestionIndex.value = savedState.currentQuestionIndex || 0
            isQuizStarted.value = savedState.isQuizStarted || false
            isQuizCompleted.value = savedState.isQuizCompleted || false
            isReviewMode.value = savedState.isReviewMode || false
            totalQuizTime.value = savedState.totalQuizTime || 0
          }
          
          // Restore answers
          if (savedAnswers && Array.isArray(savedAnswers)) {
            userAnswers.clear()
            savedAnswers.forEach(([key, value]) => {
              userAnswers.set(key, value)
            })
          }
          
          // Restore statistics
          if (savedStatistics) {
            Object.assign(statistics, savedStatistics)
          }
          
          // Restore configuration
          if (savedConfig) {
            Object.assign(quizConfig, savedConfig)
          }
          
          // Restore performance stats
          if (savedPerformance) {
            Object.assign(performanceStats, savedPerformance)
          }
          
          tracker.end({ success: true })
        })
        .catch(error => {
          tracker.end({ error: error.message })
          console.warn('Storage load failed:', error)
        })
        
    } catch (error) {
      tracker.end({ error: error.message })
      console.warn('Failed to load from storage:', error)
    }
  }
  
  /**
   * Helper functions for storage operations
   */
  async function setStorageItem(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch (error) {
      console.warn(`Storage set failed for ${key}:`, error)
    }
  }
  
  async function getStorageItem(key) {
    try {
      const item = localStorage.getItem(key)
      return item ? JSON.parse(item) : null
    } catch (error) {
      console.warn(`Storage get failed for ${key}:`, error)
      return null
    }
  }
  
  /**
   * Clear all storage
   */
  function clearStorage() {
    try {
      Object.values(STORAGE_KEYS).forEach(key => {
        localStorage.removeItem(key)
      })
    } catch (error) {
      console.warn('Failed to clear storage:', error)
    }
  }
  
  /**
   * Review mode methods
   */
  function enterReviewMode() {
    isReviewMode.value = true
    stopQuestionTimer()
    statistics.questionsReviewed++
    throttledSave()
  }
  
  function exitReviewMode() {
    isReviewMode.value = false
    throttledSave()
  }
  
  /**
   * Get question status efficiently
   */
  function getQuestionStatus(questionId) {
    const answer = userAnswers.get(questionId)
    const question = originalQuestions.value.find(q => q.id === questionId)
    
    if (!answer || !question) {
      return { answered: false, correct: null }
    }
    
    return {
      answered: true,
      correct: answer === question.answer,
      selectedAnswer: answer,
      correctAnswer: question.answer
    }
  }
  
  /**
   * Virtual scrolling helpers
   */
  function updateVisibleRange(start, end) {
    virtualScrollState.visibleRange.start = start
    virtualScrollState.visibleRange.end = end
  }
  
  function setVirtualScrollConfig(config) {
    Object.assign(virtualScrollState, config)
  }
  
  // Lifecycle management
  onMounted(() => {
    // Register global cleanup
    cleanupTasks.add(() => {
      stopQuestionTimer()
      if (memoryCleanupInterval) {
        clearInterval(memoryCleanupInterval)
      }
    })
  })
  
  onUnmounted(() => {
    // Run all cleanup tasks
    cleanupTasks.forEach(cleanup => {
      try {
        cleanup()
      } catch (error) {
        console.warn('Cleanup task failed:', error)
      }
    })
    
    cleanupTasks.clear()
    
    // Unregister memory manager tasks
    memoryManager.runCleanupTasks()
  })
  
  // Auto-save on critical changes
  watch([userAnswers, statistics], throttledSave, { deep: true })
  
  // Return optimized API
  return {
    // State (read-only where appropriate)
    questions,
    currentQuestion,
    currentQuestionIndex,
    currentQuestionNumber,
    totalQuestions,
    isQuizStarted,
    isQuizCompleted,
    isReviewMode,
    userAnswers,
    answerHistory,
    
    // Configuration
    quizConfig,
    
    // Timer
    currentQuestionTime,
    totalQuizTime,
    remainingTime,
    formattedTime,
    formattedTotalTime,
    
    // Computed
    progressPercentage,
    score,
    canGoNext,
    canGoPrevious,
    currentQuestionAnswer,
    isCurrentQuestionAnswered,
    
    // Statistics
    statistics,
    performanceStats,
    
    // Virtual scrolling
    visibleQuestions,
    virtualScrollState,
    updateVisibleRange,
    setVirtualScrollConfig,
    
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
    exitReviewMode,
    getQuestionStatus,
    getResults,
    
    // Storage
    saveToStorage,
    loadFromStorage,
    clearStorage
  }
}

export default useOptimizedQuiz