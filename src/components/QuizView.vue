<template>
  <div class="quiz-view">
    <!-- Back Button -->
    <button class="back-button" @click="goBackToPortal" title="返回首頁">
      <span class="back-arrow">←</span>
      <span class="back-text">返回首頁</span>
    </button>

    <!-- Quiz Interface (shown when quiz is not completed) -->
    <div v-if="!quizCompleted" class="quiz-interface">
      <!-- Mode Header -->
      <div class="mode-header">
        <div class="mode-info">
          <div class="mode-badge">{{ modeDisplayName }}</div>
          <div v-if="mode === 'category' && categoryDisplayName" class="category-badge">
            {{ categoryDisplayName }}
          </div>
        </div>
        <!-- Timer for Exam Mode -->
        <div v-if="mode === 'exam'" class="timer-display" :class="{ 'timer-warning': timeRemaining <= 300 }">
          <span class="timer-icon">⏱️</span>
          <span class="timer-text">{{ timerDisplay }}</span>
        </div>
      </div>

      <!-- Progress Section -->
      <div class="progress-section">
        <div class="progress-header">
          <span class="progress-label">問題 {{ currentQuestionIndex + 1 }} / {{ questions.length }}</span>
          <span class="progress-percentage">{{ progressPercentage }}% 完成</span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar-fill" :style="{ width: progressPercentage + '%' }">
            <span class="progress-bar-glow"></span>
          </div>
        </div>
      </div>

      <!-- Score Display (hidden in study mode) -->
      <div v-if="mode !== 'study'" class="score-display">
        <span class="score-icon">🎯</span>
        分數: {{ score }} / {{ questionsAnswered }}
      </div>

      <!-- Question Display -->
      <div class="question-container">
        <div class="question-badge">
          第 {{ currentQuestionIndex + 1 }} 題
        </div>
        <h2 class="question-text">{{ currentQuestion?.question }}</h2>
      </div>

      <!-- Options Display -->
      <div class="options-container" v-if="currentQuestion">
        <button
          v-for="(optionText, optionKey) in currentQuestion.options"
          :key="optionKey"
          :class="[
            'option-button',
            {
              'option-selected': selectedAnswer === optionKey,
              'option-correct': selectedAnswer !== null && showImmediateFeedback && optionKey === currentQuestion.answer,
              'option-incorrect': selectedAnswer !== null && showImmediateFeedback && selectedAnswer === optionKey && optionKey !== currentQuestion.answer,
              'option-disabled': (selectedAnswer !== null && mode !== 'study') || (mode === 'exam' && selectedAnswer !== null)
            }
          ]"
          :disabled="(selectedAnswer !== null && mode !== 'study') || (mode === 'exam' && selectedAnswer !== null)"
          @click="selectAnswer(optionKey)"
        >
          <span class="option-key">{{ optionKey }}</span>
          <span class="option-text">{{ optionText }}</span>
          <span v-if="selectedAnswer !== null && showImmediateFeedback && optionKey === currentQuestion.answer" class="feedback-icon">✓</span>
          <span v-if="selectedAnswer !== null && showImmediateFeedback && selectedAnswer === optionKey && optionKey !== currentQuestion.answer" class="feedback-icon">✗</span>
        </button>
      </div>

      <!-- Feedback Message (only shown in certain modes) -->
      <div v-if="selectedAnswer !== null && showImmediateFeedback" class="feedback-message">
        <p v-if="selectedAnswer === currentQuestion?.answer" class="correct-message">
          <span class="message-icon">🎉</span> 正確！做得好！
        </p>
        <p v-else class="incorrect-message">
          <span class="message-icon">💡</span> 不正確。正確答案是 {{ currentQuestion?.answer }}
        </p>
      </div>

      <!-- Detailed Explanation (shown based on mode) -->
      <div 
        v-if="(selectedAnswer !== null && showImmediateFeedback || mode === 'study') && currentQuestion?.explanation" 
        :class="[
          'explanation-card',
          {
            'correct-explanation': selectedAnswer === currentQuestion?.answer,
            'incorrect-explanation': selectedAnswer !== currentQuestion?.answer
          }
        ]"
      >
        <div class="explanation-header">
          <span class="explanation-icon">
            <span v-if="selectedAnswer === currentQuestion?.answer">✅</span>
            <span v-else>📚</span>
          </span>
          <h3 class="explanation-title">詳細解釋</h3>
        </div>
        <div class="explanation-content">
          <p class="explanation-text" v-html="formatExplanationText(currentQuestion.explanation)"></p>
        </div>
      </div>

      <!-- Navigation -->
      <div class="navigation-container">
        <!-- Back Button (for supported modes) -->
        <button
          v-if="canGoBack"
          @click="previousQuestion"
          class="nav-button prev-button"
        >
          <span class="button-arrow">←</span>
          <span>上一題</span>
        </button>
        
        <!-- Next Button -->
        <button
          v-if="selectedAnswer !== null || mode === 'study'"
          @click="nextQuestion"
          class="nav-button next-button"
        >
          <span v-if="!isLastQuestion">下一題</span>
          <span v-else>查看成績</span>
          <span class="button-arrow">→</span>
        </button>
      </div>
    </div>

    <!-- Results View (shown when quiz is completed) -->
    <ResultsView
      v-if="quizCompleted"
      :score="score"
      :total-questions="questions.length"
      :mode="mode"
      :answered-questions="answeredQuestions"
      @restart="restartQuiz"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import ResultsView from './ResultsView.vue'
// Import the questions from the JavaScript module
import questionsData from '../assets/questionsData.js'

// Define props
const props = defineProps({
  mode: {
    type: String,
    default: 'practice'
  },
  selectedCategory: {
    type: String,
    default: null
  }
})

// Define emits
const emit = defineEmits(['back-to-portal'])

// Reactive state to hold all the questions (filtered based on mode)
const questions = ref([])

// Timer state for exam mode
const timeRemaining = ref(5400) // 90 minutes in seconds
const timerInterval = ref(null)
const isTimerActive = ref(false)

// Reactive state to track the index of the current question
const currentQuestionIndex = ref(0)

// Reactive state for selected answer
const selectedAnswer = ref(null)

// Reactive state for score
const score = ref(0)

// Reactive state for number of questions answered
const questionsAnswered = ref(0)

// Reactive state for quiz completion
const quizCompleted = ref(false)

// Store for answered questions in exam mode
const answeredQuestions = ref(new Map())

// Navigation history for study mode
const canGoBack = ref(false)

// Computed property that returns the question object at the current index
const currentQuestion = computed(() => {
  return questions.value[currentQuestionIndex.value]
})

// Computed property to check if it's the last question
const isLastQuestion = computed(() => {
  return currentQuestionIndex.value === questions.value.length - 1
})

// Computed property for progress percentage
const progressPercentage = computed(() => {
  if (questions.value.length === 0) return 0
  return Math.round(((currentQuestionIndex.value + 1) / questions.value.length) * 100)
})

// Computed property for mode display name
const modeDisplayName = computed(() => {
  const modeNames = {
    practice: '練習模式',
    exam: '考試模式',
    category: '分類練習',
    study: '學習模式'
  }
  return modeNames[props.mode] || '練習模式'
})

// Computed property for category display name
const categoryDisplayName = computed(() => {
  if (props.mode !== 'category' || !props.selectedCategory) return ''
  return props.selectedCategory === '考科一' ? '考科一：淨零碳規劃管理基礎概論' : '考科二：淨零碳盤查範圍與程序概要'
})

// Computed property for formatted timer display
const timerDisplay = computed(() => {
  const minutes = Math.floor(timeRemaining.value / 60)
  const seconds = timeRemaining.value % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
})

// Check if immediate feedback should be shown
const showImmediateFeedback = computed(() => {
  return props.mode === 'practice' || props.mode === 'category' || props.mode === 'study'
})

// Check if navigation back is allowed
const allowBackNavigation = computed(() => {
  return props.mode === 'practice' || props.mode === 'category' || props.mode === 'study'
})

// Function to handle answer selection
function selectAnswer(optionKey) {
  // In study mode, always allow changing answers
  if (props.mode === 'study') {
    selectedAnswer.value = optionKey
    return
  }
  
  // Prevent selection if already answered (except study mode)
  if (selectedAnswer.value !== null) return
  
  selectedAnswer.value = optionKey
  
  // Don't count questions or score in study mode
  if (props.mode !== 'study') {
    questionsAnswered.value++
    
    // Check if answer is correct and update score
    if (optionKey === currentQuestion.value?.answer) {
      score.value++
    }
  }
  
  // In exam mode, store the answer
  if (props.mode === 'exam') {
    answeredQuestions.value.set(currentQuestionIndex.value, {
      questionId: currentQuestion.value?.id,
      selectedAnswer: optionKey,
      correctAnswer: currentQuestion.value?.answer,
      isCorrect: optionKey === currentQuestion.value?.answer
    })
  }
}

// Function to move to next question or complete the quiz
function nextQuestion() {
  // Check if this is the last question
  if (isLastQuestion.value) {
    // Complete the quiz
    completeQuiz()
  } else {
    // Move to next question
    currentQuestionIndex.value++
    // Reset selected answer for new question
    selectedAnswer.value = null
    
    // In study mode, always show answers
    if (props.mode === 'study') {
      // Auto-select correct answer for display
      setTimeout(() => {
        selectedAnswer.value = currentQuestion.value?.answer
      }, 100)
    }
  }
  
  // Update navigation state
  canGoBack.value = currentQuestionIndex.value > 0 && allowBackNavigation.value
}

// Function to go to previous question
function previousQuestion() {
  if (currentQuestionIndex.value > 0 && allowBackNavigation.value) {
    currentQuestionIndex.value--
    selectedAnswer.value = null
    
    // In study mode, auto-select correct answer
    if (props.mode === 'study') {
      setTimeout(() => {
        selectedAnswer.value = currentQuestion.value?.answer
      }, 100)
    }
  }
  canGoBack.value = currentQuestionIndex.value > 0 && allowBackNavigation.value
}

// Function to complete the quiz
function completeQuiz() {
  if (props.mode === 'exam') {
    stopTimer()
  }
  quizCompleted.value = true
}

// Function to restart the quiz
function restartQuiz() {
  currentQuestionIndex.value = 0
  selectedAnswer.value = null
  score.value = 0
  questionsAnswered.value = 0
  quizCompleted.value = false
  answeredQuestions.value.clear()
  canGoBack.value = false
  
  // Reset timer for exam mode
  if (props.mode === 'exam') {
    timeRemaining.value = 5400
    startTimer()
  }
  
  // Initialize questions based on mode
  initializeQuestions()
}

// Function to go back to portal
function goBackToPortal() {
  emit('back-to-portal')
}

// Timer functions
function startTimer() {
  if (props.mode !== 'exam') return
  
  isTimerActive.value = true
  timerInterval.value = setInterval(() => {
    timeRemaining.value--
    
    if (timeRemaining.value <= 0) {
      // Time's up - complete quiz automatically
      completeQuiz()
    }
  }, 1000)
}

function stopTimer() {
  if (timerInterval.value) {
    clearInterval(timerInterval.value)
    timerInterval.value = null
  }
  isTimerActive.value = false
}

// Function to filter questions based on mode and category
function filterQuestions() {
  let filteredQuestions = [...questionsData]
  
  if (props.mode === 'category' && props.selectedCategory) {
    filteredQuestions = questionsData.filter(question => {
      return question.subject.includes(props.selectedCategory)
    })
  }
  
  return filteredQuestions
}

// Function to initialize questions based on mode
function initializeQuestions() {
  questions.value = filterQuestions()
  
  // In study mode, auto-select first answer
  if (props.mode === 'study' && questions.value.length > 0) {
    setTimeout(() => {
      selectedAnswer.value = currentQuestion.value?.answer
    }, 100)
  }
}

// Function to format explanation text with reference styling
function formatExplanationText(text) {
  if (!text) return ''
  
  // Replace reference numbers in brackets with styled spans
  return text.replace(/\[([^\]]+)\]/g, '<span class="reference-indicator">[$1]</span>')
}

// Lifecycle hooks
onMounted(() => {
  initializeQuestions()
  
  // Start timer for exam mode
  if (props.mode === 'exam') {
    startTimer()
  }
})

onUnmounted(() => {
  stopTimer()
})
</script>

<style scoped>
.quiz-view {
  width: 100%;
  max-width: 800px;
  background: white;
  border-radius: 24px;
  padding: 40px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.08);
  border: 1px solid rgba(0, 0, 0, 0.05);
  position: relative;
}

/* Back Button */
.back-button {
  position: absolute;
  top: 20px;
  left: 20px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: rgba(102, 126, 234, 0.1);
  border: 1px solid rgba(102, 126, 234, 0.2);
  border-radius: 12px;
  color: #667eea;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
  z-index: 10;
}

.back-button:hover {
  background: rgba(102, 126, 234, 0.15);
  border-color: rgba(102, 126, 234, 0.3);
  transform: translateX(-2px);
}

.back-arrow {
  font-size: 1.1rem;
  transition: transform 0.3s ease;
}

.back-button:hover .back-arrow {
  transform: translateX(-3px);
}

.back-text {
  font-weight: 600;
}

.quiz-interface {
  width: 100%;
}

/* Mode Header */
.mode-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 25px;
  padding: 20px;
  background: linear-gradient(135deg, #f0f3ff 0%, #e8ecff 100%);
  border-radius: 16px;
  border: 1px solid rgba(102, 126, 234, 0.15);
}

.mode-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mode-badge {
  display: inline-block;
  padding: 8px 16px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-radius: 20px;
  font-size: 0.9rem;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.25);
}

.category-badge {
  display: inline-block;
  padding: 6px 12px;
  background: rgba(102, 126, 234, 0.1);
  color: #667eea;
  border-radius: 16px;
  font-size: 0.85rem;
  font-weight: 500;
  border: 1px solid rgba(102, 126, 234, 0.2);
}

/* Timer Display */
.timer-display {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  background: white;
  border-radius: 12px;
  border: 2px solid #e2e8f0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  transition: all 0.3s ease;
}

.timer-display.timer-warning {
  border-color: #fc8181;
  background: linear-gradient(135deg, #fff5f5 0%, #fee 100%);
  animation: timerPulse 2s infinite;
}

@keyframes timerPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

.timer-icon {
  font-size: 1.3rem;
}

.timer-text {
  font-size: 1.2rem;
  font-weight: 700;
  color: #2d3748;
  font-variant-numeric: tabular-nums;
}

.timer-warning .timer-text {
  color: #c53030;
}

/* Progress Section */
.progress-section {
  margin-bottom: 30px;
  padding: 20px;
  background: linear-gradient(135deg, #f8f9ff 0%, #f0f3ff 100%);
  border-radius: 16px;
  border: 1px solid rgba(102, 126, 234, 0.1);
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.progress-label {
  font-size: 1.1rem;
  font-weight: 600;
  color: #4a5568;
}

.progress-percentage {
  font-size: 0.95rem;
  font-weight: 500;
  color: #667eea;
  background: white;
  padding: 4px 12px;
  border-radius: 20px;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.15);
}

.progress-bar-container {
  width: 100%;
  height: 14px;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 10px;
  overflow: hidden;
  position: relative;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.06);
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
  border-radius: 10px;
  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
}

.progress-bar-glow {
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, 
    transparent,
    rgba(255, 255, 255, 0.4),
    transparent
  );
  animation: shimmer 2s infinite;
}

@keyframes shimmer {
  0% {
    left: -100%;
  }
  100% {
    left: 100%;
  }
}

/* Score Display */
.score-display {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 1.15rem;
  font-weight: 600;
  color: #2d3748;
  margin-bottom: 25px;
  padding: 12px 20px;
  background: linear-gradient(135deg, #fff 0%, #f7fafc 100%);
  border-radius: 12px;
  border: 2px solid #e2e8f0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.score-icon {
  font-size: 1.3rem;
}

/* Question Container */
.question-container {
  margin-bottom: 35px;
  position: relative;
}

.question-badge {
  display: inline-block;
  color: #667eea;
  font-size: 0.9rem;
  font-weight: 600;
  margin-bottom: 15px;
  padding: 6px 16px;
  background: linear-gradient(135deg, #f0f3ff 0%, #e8ecff 100%);
  border-radius: 20px;
  border: 1px solid rgba(102, 126, 234, 0.2);
}

.question-text {
  color: #1a202c;
  font-size: 1.5rem;
  line-height: 1.7;
  font-weight: 600;
  letter-spacing: -0.01em;
}

/* Options Container */
.options-container {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-bottom: 30px;
}

.option-button {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 18px;
  border: 2px solid #e2e8f0;
  border-radius: 14px;
  background: white;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  font-size: 1.05rem;
  text-align: left;
  position: relative;
}

.option-button:hover:not(.option-disabled) {
  border-color: #667eea;
  background: linear-gradient(135deg, #fafbff 0%, #f7f9ff 100%);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
}

.option-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-radius: 50%;
  font-weight: 600;
  margin-right: 18px;
  flex-shrink: 0;
  font-size: 1.1rem;
}

.option-text {
  flex: 1;
  color: #2d3748;
  line-height: 1.5;
}

/* Visual Feedback States */
.option-selected {
  border-color: #667eea;
  background: linear-gradient(135deg, #f0f3ff 0%, #e8ecff 100%);
  transform: scale(1.02);
}

.option-correct {
  border-color: #48bb78 !important;
  background: linear-gradient(135deg, #f0fff4 0%, #e6ffed 100%) !important;
}

.option-correct .option-key {
  background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
}

.option-incorrect {
  border-color: #fc8181 !important;
  background: linear-gradient(135deg, #fff5f5 0%, #fee 100%) !important;
}

.option-incorrect .option-key {
  background: linear-gradient(135deg, #fc8181 0%, #f56565 100%);
}

.option-disabled {
  cursor: not-allowed;
  opacity: 0.95;
}

.option-disabled:hover {
  transform: none;
}

/* Feedback Icon */
.feedback-icon {
  position: absolute;
  right: 20px;
  font-size: 1.4rem;
  font-weight: bold;
}

.option-correct .feedback-icon {
  color: #38a169;
}

.option-incorrect .feedback-icon {
  color: #e53e3e;
}

/* Feedback Message */
.feedback-message {
  padding: 16px;
  border-radius: 12px;
  margin-bottom: 25px;
  text-align: center;
  font-size: 1.05rem;
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.correct-message {
  color: #22543d;
  background: linear-gradient(135deg, #c6f6d5 0%, #b2f5c4 100%);
  border: 1px solid rgba(72, 187, 120, 0.3);
  margin: 0;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.incorrect-message {
  color: #742a2a;
  background: linear-gradient(135deg, #fed7d7 0%, #fecaca 100%);
  border: 1px solid rgba(245, 101, 101, 0.3);
  margin: 0;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.message-icon {
  font-size: 1.3rem;
}

/* Explanation Card */
.explanation-card {
  margin: 25px 0;
  background: linear-gradient(135deg, #fafbff 0%, #f7f9ff 100%);
  border: 2px solid rgba(102, 126, 234, 0.15);
  border-radius: 16px;
  overflow: hidden;
  animation: explanationSlideIn 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 8px 25px rgba(102, 126, 234, 0.08);
}

@keyframes explanationSlideIn {
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.explanation-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 24px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.explanation-icon {
  font-size: 1.4rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 50%;
  backdrop-filter: blur(10px);
}

.explanation-title {
  font-size: 1.2rem;
  font-weight: 600;
  margin: 0;
  letter-spacing: -0.02em;
}

.explanation-content {
  padding: 24px;
}

.explanation-text {
  font-size: 1.05rem;
  line-height: 1.7;
  color: #2d3748;
  margin: 0;
  text-align: justify;
  word-spacing: 0.05em;
}

/* Reference Indicators */
.reference-indicator {
  display: inline-block;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 600;
  margin: 0 2px;
  box-shadow: 0 2px 6px rgba(102, 126, 234, 0.25);
  transform: translateY(-1px);
}

/* Correct/Incorrect Explanation Variants */
.explanation-card.correct-explanation {
  background: linear-gradient(135deg, #f0fff4 0%, #e6ffed 100%);
  border-color: rgba(72, 187, 120, 0.3);
}

.explanation-card.correct-explanation .explanation-header {
  background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
}

.explanation-card.incorrect-explanation {
  background: linear-gradient(135deg, #fff5f5 0%, #fee 100%);
  border-color: rgba(245, 101, 101, 0.3);
}

.explanation-card.incorrect-explanation .explanation-header {
  background: linear-gradient(135deg, #fc8181 0%, #f56565 100%);
}

/* Navigation */
.navigation-container {
  display: flex;
  justify-content: center;
  gap: 15px;
  margin-top: 30px;
}

.nav-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 16px 32px;
  border: none;
  border-radius: 14px;
  font-size: 1.1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.next-button {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  box-shadow: 0 4px 20px rgba(102, 126, 234, 0.25);
}

.next-button:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 30px rgba(102, 126, 234, 0.35);
}

.prev-button {
  background: rgba(102, 126, 234, 0.1);
  color: #667eea;
  border: 1px solid rgba(102, 126, 234, 0.2);
}

.prev-button:hover {
  background: rgba(102, 126, 234, 0.15);
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.2);
}

.nav-button:active {
  transform: translateY(-1px);
}

.button-arrow {
  font-size: 1.3rem;
  transition: transform 0.3s ease;
}

.next-button:hover .button-arrow {
  transform: translateX(3px);
}

.prev-button:hover .button-arrow {
  transform: translateX(-3px);
}

/* Responsive Design */
@media (max-width: 768px) {
  .quiz-view {
    padding: 25px;
    border-radius: 20px;
  }

  .back-button {
    top: 15px;
    left: 15px;
    padding: 8px 12px;
    font-size: 0.85rem;
  }

  .back-text {
    display: none;
  }

  .progress-section {
    padding: 15px;
  }

  .progress-label {
    font-size: 1rem;
  }

  .progress-percentage {
    font-size: 0.9rem;
  }

  .question-text {
    font-size: 1.3rem;
  }

  .option-button {
    padding: 15px;
  }

  .option-key {
    width: 34px;
    height: 34px;
    margin-right: 14px;
    font-size: 1rem;
  }

  .option-text {
    font-size: 1rem;
  }

  .nav-button {
    padding: 14px 24px;
    font-size: 1rem;
  }
  
  .navigation-container {
    gap: 10px;
  }
  
  /* Mode Header Mobile Styles */
  .mode-header {
    flex-direction: column;
    gap: 15px;
    padding: 15px;
  }
  
  .mode-badge {
    font-size: 0.85rem;
    padding: 6px 12px;
  }
  
  .category-badge {
    font-size: 0.8rem;
    padding: 4px 10px;
  }
  
  .timer-display {
    align-self: center;
    padding: 10px 16px;
  }
  
  .timer-text {
    font-size: 1.1rem;
  }

  /* Explanation Card Mobile Styles */
  .explanation-card {
    margin: 20px 0;
    border-radius: 12px;
  }

  .explanation-header {
    padding: 15px 18px;
    gap: 10px;
  }

  .explanation-icon {
    width: 32px;
    height: 32px;
    font-size: 1.2rem;
  }

  .explanation-title {
    font-size: 1.1rem;
  }

  .explanation-content {
    padding: 18px;
  }

  .explanation-text {
    font-size: 1rem;
    line-height: 1.6;
  }

  .reference-indicator {
    font-size: 0.8rem;
    padding: 1px 6px;
  }
  
  /* Hide category badge on very small screens */
  .category-badge {
    display: none;
  }
  
  .timer-display {
    padding: 8px 12px;
  }
  
  .timer-text {
    font-size: 1rem;
  }
}
</style>