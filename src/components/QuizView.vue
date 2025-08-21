<template>
  <div class="quiz-view">
    <!-- Quiz Interface (shown when quiz is not completed) -->
    <div v-if="!quizCompleted" class="quiz-interface">
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

      <!-- Score Display -->
      <div class="score-display">
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
              'option-correct': selectedAnswer !== null && optionKey === currentQuestion.answer,
              'option-incorrect': selectedAnswer !== null && selectedAnswer === optionKey && optionKey !== currentQuestion.answer,
              'option-disabled': selectedAnswer !== null
            }
          ]"
          :disabled="selectedAnswer !== null"
          @click="selectAnswer(optionKey)"
        >
          <span class="option-key">{{ optionKey }}</span>
          <span class="option-text">{{ optionText }}</span>
          <span v-if="selectedAnswer !== null && optionKey === currentQuestion.answer" class="feedback-icon">✓</span>
          <span v-if="selectedAnswer !== null && selectedAnswer === optionKey && optionKey !== currentQuestion.answer" class="feedback-icon">✗</span>
        </button>
      </div>

      <!-- Feedback Message -->
      <div v-if="selectedAnswer !== null" class="feedback-message">
        <p v-if="selectedAnswer === currentQuestion?.answer" class="correct-message">
          <span class="message-icon">🎉</span> 正確！做得好！
        </p>
        <p v-else class="incorrect-message">
          <span class="message-icon">💡</span> 不正確。正確答案是 {{ currentQuestion?.answer }}
        </p>
      </div>

      <!-- Navigation -->
      <div class="navigation-container">
        <button
          v-if="selectedAnswer !== null"
          @click="nextQuestion"
          class="next-button"
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
      @restart="restartQuiz"
    />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import ResultsView from './ResultsView.vue'
// Import the questions from the JavaScript module
import questionsData from '../assets/questionsData.js'

// Reactive state to hold all the questions
const questions = ref(questionsData)

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

// Function to handle answer selection
function selectAnswer(optionKey) {
  // Prevent selection if already answered
  if (selectedAnswer.value !== null) return
  
  selectedAnswer.value = optionKey
  questionsAnswered.value++
  
  // Check if answer is correct and update score
  if (optionKey === currentQuestion.value?.answer) {
    score.value++
  }
}

// Function to move to next question or complete the quiz
function nextQuestion() {
  // Check if this is the last question
  if (isLastQuestion.value) {
    // Complete the quiz
    quizCompleted.value = true
  } else {
    // Move to next question
    currentQuestionIndex.value++
    // Reset selected answer for new question
    selectedAnswer.value = null
  }
}

// Function to restart the quiz
function restartQuiz() {
  currentQuestionIndex.value = 0
  selectedAnswer.value = null
  score.value = 0
  questionsAnswered.value = 0
  quizCompleted.value = false
}
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
}

.quiz-interface {
  width: 100%;
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

/* Navigation */
.navigation-container {
  display: flex;
  justify-content: center;
  margin-top: 30px;
}

.next-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 16px 36px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 14px;
  font-size: 1.15rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 4px 20px rgba(102, 126, 234, 0.25);
}

.next-button:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 30px rgba(102, 126, 234, 0.35);
}

.next-button:active {
  transform: translateY(-1px);
}

.button-arrow {
  font-size: 1.3rem;
  transition: transform 0.3s ease;
}

.next-button:hover .button-arrow {
  transform: translateX(3px);
}

/* Responsive Design */
@media (max-width: 768px) {
  .quiz-view {
    padding: 25px;
    border-radius: 20px;
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

  .next-button {
    padding: 14px 28px;
    font-size: 1.05rem;
  }
}
</style>