import { ref, computed, reactive, watch, onMounted, onUnmounted } from 'vue'

/**
 * Advanced Quiz State Management Composable
 * Provides comprehensive quiz functionality with scoring, timing, persistence, and navigation
 */
export function useQuiz(initialQuestions = []) {
  // Core quiz state
  const originalQuestions = ref([...initialQuestions])
  const questions = ref([...initialQuestions])
  const currentQuestionIndex = ref(0)
  const isQuizStarted = ref(false)
  const isQuizCompleted = ref(false)
  const isReviewMode = ref(false)
  
  // Timer state
  const timePerQuestion = ref(60) // seconds per question
  const currentQuestionTime = ref(0)
  const totalQuizTime = ref(0)
  const timerInterval = ref(null)
  const isTimerEnabled = ref(true)
  
  // Answer tracking
  const userAnswers = reactive(new Map())
  const answerHistory = ref([])
  const questionStartTimes = reactive(new Map())
  
  // Quiz configuration
  const shuffleQuestions = ref(false)
  const shuffleOptions = ref(false)
  const randomizeQuestionOrder = ref(false)
  
  // Statistics
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
  
  // Keyboard navigation state
  const keyboardEnabled = ref(true)
  
  // Computed properties
  const currentQuestion = computed(() => {
    if (questions.value.length === 0 || currentQuestionIndex.value >= questions.value.length) {
      return null
    }
    return questions.value[currentQuestionIndex.value]
  })
  
  const currentQuestionNumber = computed(() => currentQuestionIndex.value + 1)
  
  const totalQuestions = computed(() => questions.value.length)
  
  const progressPercentage = computed(() => {
    if (totalQuestions.value === 0) return 0
    return Math.round((currentQuestionNumber.value / totalQuestions.value) * 100)
  })
  
  const score = computed(() => {
    let correct = 0
    let total = 0
    
    userAnswers.forEach((answer, questionId) => {
      const question = originalQuestions.value.find(q => q.id === questionId)
      if (question) {
        total++
        if (answer === question.answer) {
          correct++
        }
      }
    })
    
    return {
      correct,
      total,
      percentage: total > 0 ? Math.round((correct / total) * 100) : 0
    }
  })
  
  const canGoNext = computed(() => {
    return currentQuestionIndex.value < questions.value.length - 1
  })
  
  const canGoPrevious = computed(() => {
    return currentQuestionIndex.value > 0
  })
  
  const currentQuestionAnswer = computed(() => {
    if (!currentQuestion.value) return null
    return userAnswers.get(currentQuestion.value.id) || null
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
  
  // Storage keys
  const STORAGE_KEYS = {
    QUIZ_STATE: 'ipas-quiz-state',
    USER_ANSWERS: 'ipas-quiz-answers',
    STATISTICS: 'ipas-quiz-statistics',
    CONFIG: 'ipas-quiz-config'
  }
  
  /**
   * Shuffle array using Fisher-Yates algorithm
   */
  function shuffleArray(array) {
    const shuffled = [...array]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
  }
  
  /**
   * Shuffle question options while preserving correct answer mapping
   */
  function shuffleQuestionOptions(question) {
    if (!shuffleOptions.value || !question.options) return question
    
    const optionKeys = Object.keys(question.options)
    const optionValues = Object.values(question.options)
    const shuffledValues = shuffleArray(optionValues)
    
    const shuffledOptions = {}
    const answerMapping = {}
    
    optionKeys.forEach((key, index) => {
      shuffledOptions[key] = shuffledValues[index]
      // Find which original key had this value
      const originalKey = Object.keys(question.options).find(
        k => question.options[k] === shuffledValues[index]
      )
      answerMapping[originalKey] = key
    })
    
    return {
      ...question,
      options: shuffledOptions,
      answer: answerMapping[question.answer] || question.answer
    }
  }
  
  /**
   * Initialize quiz with configuration
   */
  function initializeQuiz(config = {}) {
    // Apply configuration
    if (config.shuffleQuestions !== undefined) {
      shuffleQuestions.value = config.shuffleQuestions
    }
    if (config.shuffleOptions !== undefined) {
      shuffleOptions.value = config.shuffleOptions
    }
    if (config.timePerQuestion !== undefined) {
      timePerQuestion.value = config.timePerQuestion
    }
    if (config.isTimerEnabled !== undefined) {
      isTimerEnabled.value = config.isTimerEnabled
    }
    
    // Prepare questions
    let preparedQuestions = [...originalQuestions.value]
    
    if (shuffleQuestions.value) {
      preparedQuestions = shuffleArray(preparedQuestions)
    }
    
    if (shuffleOptions.value) {
      preparedQuestions = preparedQuestions.map(shuffleQuestionOptions)
    }
    
    questions.value = preparedQuestions
    
    // Reset state
    currentQuestionIndex.value = 0
    isQuizCompleted.value = false
    isReviewMode.value = false
    userAnswers.clear()
    answerHistory.value = []
    questionStartTimes.clear()
    
    loadFromStorage()
  }
  
  /**
   * Start the quiz
   */
  function startQuiz() {
    isQuizStarted.value = true
    statistics.lastSessionDate = new Date().toISOString()
    
    if (isTimerEnabled.value) {
      startQuestionTimer()
    }
    
    recordQuestionStartTime()
    saveToStorage()
  }
  
  /**
   * Start timer for current question
   */
  function startQuestionTimer() {
    if (timerInterval.value) {
      clearInterval(timerInterval.value)
    }
    
    currentQuestionTime.value = 0
    
    timerInterval.value = setInterval(() => {
      currentQuestionTime.value++
      totalQuizTime.value++
      
      if (currentQuestionTime.value >= timePerQuestion.value) {
        // Time's up for this question
        handleTimeUp()
      }
    }, 1000)
  }
  
  /**
   * Stop the current question timer
   */
  function stopQuestionTimer() {
    if (timerInterval.value) {
      clearInterval(timerInterval.value)
      timerInterval.value = null
    }
  }
  
  /**
   * Handle time up for current question
   */
  function handleTimeUp() {
    stopQuestionTimer()
    
    // Auto-advance to next question if not answered
    if (!isCurrentQuestionAnswered.value) {
      recordAnswer(null) // Record no answer
      if (canGoNext.value) {
        nextQuestion()
      } else {
        completeQuiz()
      }
    }
  }
  
  /**
   * Record when question viewing started
   */
  function recordQuestionStartTime() {
    if (currentQuestion.value) {
      questionStartTimes.set(currentQuestion.value.id, Date.now())
    }
  }
  
  /**
   * Answer current question
   */
  function answerQuestion(selectedOption) {
    if (!currentQuestion.value || isQuizCompleted.value) return
    
    recordAnswer(selectedOption)
    
    // Auto-advance after a short delay for user feedback
    setTimeout(() => {
      if (canGoNext.value) {
        nextQuestion()
      } else {
        completeQuiz()
      }
    }, 1000)
  }
  
  /**
   * Record answer and update statistics
   */
  function recordAnswer(selectedOption) {
    if (!currentQuestion.value) return
    
    const questionId = currentQuestion.value.id
    const isCorrect = selectedOption === currentQuestion.value.answer
    
    // Record answer
    userAnswers.set(questionId, selectedOption)
    
    // Record in history
    const timeSpent = questionStartTimes.has(questionId) 
      ? Date.now() - questionStartTimes.get(questionId)
      : 0
    
    answerHistory.value.push({
      questionId,
      question: currentQuestion.value.question,
      selectedAnswer: selectedOption,
      correctAnswer: currentQuestion.value.answer,
      isCorrect,
      timeSpent: Math.round(timeSpent / 1000), // in seconds
      timestamp: new Date().toISOString()
    })
    
    // Update statistics
    updateStatistics(isCorrect, timeSpent)
    
    saveToStorage()
  }
  
  /**
   * Update quiz statistics
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
    
    statistics.totalTimeSpent += Math.round(timeSpent / 1000)
    statistics.averageTimePerQuestion = Math.round(
      statistics.totalTimeSpent / statistics.totalQuestionsAnswered
    )
    statistics.accuracyPercentage = Math.round(
      (statistics.correctAnswers / statistics.totalQuestionsAnswered) * 100
    )
  }
  
  /**
   * Navigate to next question
   */
  function nextQuestion() {
    if (!canGoNext.value) return
    
    stopQuestionTimer()
    currentQuestionIndex.value++
    recordQuestionStartTime()
    
    if (isTimerEnabled.value && !isQuizCompleted.value) {
      startQuestionTimer()
    }
    
    saveToStorage()
  }
  
  /**
   * Navigate to previous question
   */
  function previousQuestion() {
    if (!canGoPrevious.value) return
    
    stopQuestionTimer()
    currentQuestionIndex.value--
    recordQuestionStartTime()
    
    if (isTimerEnabled.value && !isQuizCompleted.value) {
      startQuestionTimer()
    }
    
    saveToStorage()
  }
  
  /**
   * Jump to specific question
   */
  function goToQuestion(index) {
    if (index < 0 || index >= questions.value.length) return
    
    stopQuestionTimer()
    currentQuestionIndex.value = index
    recordQuestionStartTime()
    
    if (isTimerEnabled.value && !isQuizCompleted.value) {
      startQuestionTimer()
    }
    
    saveToStorage()
  }
  
  /**
   * Complete the quiz
   */
  function completeQuiz() {
    stopQuestionTimer()
    isQuizCompleted.value = true
    
    // Final statistics update
    statistics.lastSessionDate = new Date().toISOString()
    
    saveToStorage()
  }
  
  /**
   * Enter review mode
   */
  function enterReviewMode() {
    isReviewMode.value = true
    stopQuestionTimer()
    statistics.questionsReviewed++
    saveToStorage()
  }
  
  /**
   * Exit review mode
   */
  function exitReviewMode() {
    isReviewMode.value = false
    saveToStorage()
  }
  
  /**
   * Reset quiz to initial state
   */
  function resetQuiz() {
    stopQuestionTimer()
    
    currentQuestionIndex.value = 0
    isQuizStarted.value = false
    isQuizCompleted.value = false
    isReviewMode.value = false
    currentQuestionTime.value = 0
    totalQuizTime.value = 0
    
    userAnswers.clear()
    answerHistory.value = []
    questionStartTimes.clear()
    
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
  }
  
  /**
   * Get answer status for a question
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
   * Get detailed results
   */
  function getResults() {
    const results = []
    
    questions.value.forEach(question => {
      const status = getQuestionStatus(question.id)
      const history = answerHistory.value.find(h => h.questionId === question.id)
      
      results.push({
        question,
        ...status,
        timeSpent: history?.timeSpent || 0,
        explanation: question.explanation
      })
    })
    
    return {
      questions: results,
      score: score.value,
      statistics: { ...statistics },
      totalTime: formattedTotalTime.value
    }
  }
  
  /**
   * Save state to localStorage
   */
  function saveToStorage() {
    try {
      const state = {
        currentQuestionIndex: currentQuestionIndex.value,
        isQuizStarted: isQuizStarted.value,
        isQuizCompleted: isQuizCompleted.value,
        isReviewMode: isReviewMode.value,
        totalQuizTime: totalQuizTime.value,
        questions: questions.value
      }
      
      const config = {
        shuffleQuestions: shuffleQuestions.value,
        shuffleOptions: shuffleOptions.value,
        timePerQuestion: timePerQuestion.value,
        isTimerEnabled: isTimerEnabled.value
      }
      
      localStorage.setItem(STORAGE_KEYS.QUIZ_STATE, JSON.stringify(state))
      localStorage.setItem(STORAGE_KEYS.USER_ANSWERS, JSON.stringify([...userAnswers]))
      localStorage.setItem(STORAGE_KEYS.STATISTICS, JSON.stringify(statistics))
      localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(config))
    } catch (error) {
      console.warn('Failed to save quiz state to localStorage:', error)
    }
  }
  
  /**
   * Load state from localStorage
   */
  function loadFromStorage() {
    try {
      const savedState = localStorage.getItem(STORAGE_KEYS.QUIZ_STATE)
      const savedAnswers = localStorage.getItem(STORAGE_KEYS.USER_ANSWERS)
      const savedStatistics = localStorage.getItem(STORAGE_KEYS.STATISTICS)
      const savedConfig = localStorage.getItem(STORAGE_KEYS.CONFIG)
      
      if (savedState) {
        const state = JSON.parse(savedState)
        currentQuestionIndex.value = state.currentQuestionIndex || 0
        isQuizStarted.value = state.isQuizStarted || false
        isQuizCompleted.value = state.isQuizCompleted || false
        isReviewMode.value = state.isReviewMode || false
        totalQuizTime.value = state.totalQuizTime || 0
        
        if (state.questions && state.questions.length > 0) {
          questions.value = state.questions
        }
      }
      
      if (savedAnswers) {
        const answers = JSON.parse(savedAnswers)
        userAnswers.clear()
        answers.forEach(([key, value]) => {
          userAnswers.set(key, value)
        })
      }
      
      if (savedStatistics) {
        Object.assign(statistics, JSON.parse(savedStatistics))
      }
      
      if (savedConfig) {
        const config = JSON.parse(savedConfig)
        shuffleQuestions.value = config.shuffleQuestions ?? false
        shuffleOptions.value = config.shuffleOptions ?? false
        timePerQuestion.value = config.timePerQuestion ?? 60
        isTimerEnabled.value = config.isTimerEnabled ?? true
      }
    } catch (error) {
      console.warn('Failed to load quiz state from localStorage:', error)
    }
  }
  
  /**
   * Clear all stored data
   */
  function clearStorage() {
    try {
      Object.values(STORAGE_KEYS).forEach(key => {
        localStorage.removeItem(key)
      })
    } catch (error) {
      console.warn('Failed to clear localStorage:', error)
    }
  }
  
  /**
   * Keyboard event handler
   */
  function handleKeypress(event) {
    if (!keyboardEnabled.value || !currentQuestion.value || isQuizCompleted.value) {
      return
    }
    
    const key = event.key.toLowerCase()
    const validKeys = ['a', 'b', 'c', 'd']
    
    if (validKeys.includes(key)) {
      event.preventDefault()
      const optionKey = key.toUpperCase()
      
      if (currentQuestion.value.options && currentQuestion.value.options[optionKey]) {
        answerQuestion(optionKey)
      }
    }
    
    // Navigation keys
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault()
        if (canGoPrevious.value) {
          previousQuestion()
        }
        break
      case 'ArrowRight':
        event.preventDefault()
        if (canGoNext.value) {
          nextQuestion()
        }
        break
      case 'Enter':
        event.preventDefault()
        if (isQuizCompleted.value) {
          enterReviewMode()
        }
        break
      case 'Escape':
        event.preventDefault()
        if (isReviewMode.value) {
          exitReviewMode()
        }
        break
    }
  }
  
  // Lifecycle hooks
  onMounted(() => {
    if (keyboardEnabled.value) {
      document.addEventListener('keydown', handleKeypress)
    }
  })
  
  onUnmounted(() => {
    stopQuestionTimer()
    if (keyboardEnabled.value) {
      document.removeEventListener('keydown', handleKeypress)
    }
  })
  
  // Watch for question changes to handle timing
  watch(currentQuestionIndex, (newIndex, oldIndex) => {
    if (newIndex !== oldIndex && isQuizStarted.value && !isQuizCompleted.value) {
      recordQuestionStartTime()
    }
  })
  
  // Auto-save periodically
  watch([userAnswers, statistics], () => {
    saveToStorage()
  }, { deep: true })
  
  return {
    // State
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
    shuffleQuestions,
    shuffleOptions,
    timePerQuestion,
    isTimerEnabled,
    keyboardEnabled,
    
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