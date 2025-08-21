<template>
  <div class="quiz-progress">
    <!-- Progress Header -->
    <div class="progress-header">
      <div class="progress-info">
        <h3 class="progress-title">測驗進度</h3>
        <div class="progress-stats">
          <span class="current-question">第 {{ currentQuestionIndex + 1 }} 題</span>
          <span class="separator">／</span>
          <span class="total-questions">共 {{ totalQuestions }} 題</span>
        </div>
      </div>
      <div class="progress-percentage">{{ progressPercentage }}%</div>
    </div>

    <!-- Progress Bar -->
    <div class="progress-bar-container">
      <div
        class="progress-bar"
        :style="{ width: progressPercentage + '%' }"
      ></div>
    </div>

    <!-- Question Grid for Review Mode -->
    <div v-if="showQuestionGrid" class="question-grid">
      <div class="grid-header">
        <h4>題目瀏覽</h4>
        <div class="legend">
          <div class="legend-item">
            <div class="legend-color answered"></div>
            <span>已答題</span>
          </div>
          <div class="legend-item">
            <div class="legend-color correct"></div>
            <span>答對</span>
          </div>
          <div class="legend-item">
            <div class="legend-color incorrect"></div>
            <span>答錯</span>
          </div>
          <div class="legend-item">
            <div class="legend-color current"></div>
            <span>目前題目</span>
          </div>
        </div>
      </div>
      
      <div class="grid-container">
        <button
          v-for="(question, index) in questions"
          :key="question.id"
          class="grid-item"
          :class="{
            'current': index === currentQuestionIndex,
            'answered': isQuestionAnswered(index),
            'correct': mode === 'review' && isQuestionCorrect(index),
            'incorrect': mode === 'review' && isQuestionAnswered(index) && !isQuestionCorrect(index),
            'unanswered': !isQuestionAnswered(index)
          }"
          @click="$emit('go-to-question', index)"
          :title="`題目 ${index + 1}: ${getQuestionPreview(question)}`"
        >
          {{ index + 1 }}
        </button>
      </div>
    </div>

    <!-- Quick Stats -->
    <div v-if="mode !== 'quiz'" class="quick-stats">
      <div class="stat-item">
        <div class="stat-number">{{ answeredCount }}</div>
        <div class="stat-label">已答題數</div>
      </div>
      <div v-if="mode === 'review'" class="stat-item">
        <div class="stat-number correct">{{ correctCount }}</div>
        <div class="stat-label">答對題數</div>
      </div>
      <div v-if="mode === 'review'" class="stat-item">
        <div class="stat-number incorrect">{{ incorrectCount }}</div>
        <div class="stat-label">答錯題數</div>
      </div>
      <div v-if="mode === 'review'" class="stat-item">
        <div class="stat-number percentage">{{ Math.round((correctCount / totalQuestions) * 100) }}%</div>
        <div class="stat-label">正確率</div>
      </div>
    </div>

    <!-- Subject Progress (for results mode) -->
    <div v-if="mode === 'results' && subjectResults" class="subject-progress">
      <h4>各科目表現</h4>
      <div
        v-for="(result, subject) in subjectResults"
        :key="subject"
        class="subject-item"
      >
        <div class="subject-name">{{ subject }}</div>
        <div class="subject-stats">
          <span class="subject-score">{{ result.correct }}/{{ result.total }}</span>
          <div class="subject-bar-container">
            <div
              class="subject-bar"
              :style="{ width: (result.correct / result.total * 100) + '%' }"
            ></div>
          </div>
          <span class="subject-percentage">{{ Math.round((result.correct / result.total) * 100) }}%</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { QuizQuestion, QuizMode } from '../types/quiz'

interface Props {
  currentQuestionIndex: number
  totalQuestions: number
  answeredCount: number
  correctCount?: number
  incorrectCount?: number
  mode: QuizMode
  questions: QuizQuestion[]
  showQuestionGrid?: boolean
  subjectResults?: Record<string, { correct: number; total: number }>
  isQuestionAnswered: (index: number) => boolean
  isQuestionCorrect?: (index: number) => boolean
}

interface Emits {
  (e: 'go-to-question', index: number): void
}

const props = withDefaults(defineProps<Props>(), {
  showQuestionGrid: false,
  correctCount: 0,
  incorrectCount: 0
})

defineEmits<Emits>()

const progressPercentage = computed(() => {
  if (props.totalQuestions === 0) return 0
  return Math.round(((props.currentQuestionIndex + 1) / props.totalQuestions) * 100)
})

function getQuestionPreview(question: QuizQuestion): string {
  return question.question.length > 50 
    ? question.question.substring(0, 50) + '...' 
    : question.question
}
</script>

<style scoped>
.quiz-progress {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  margin-bottom: 24px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.progress-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.progress-title {
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
}

.progress-stats {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  color: #6b7280;
}

.current-question {
  font-weight: 600;
  color: #6366f1;
}

.separator {
  color: #d1d5db;
}

.progress-percentage {
  font-size: 24px;
  font-weight: 700;
  color: #6366f1;
}

.progress-bar-container {
  width: 100%;
  height: 8px;
  background: #e5e7eb;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 24px;
}

.progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.question-grid {
  margin-top: 24px;
}

.grid-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.grid-header h4 {
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
}

.legend {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #6b7280;
}

.legend-color {
  width: 12px;
  height: 12px;
  border-radius: 2px;
}

.legend-color.answered {
  background: #d1d5db;
}

.legend-color.correct {
  background: #10b981;
}

.legend-color.incorrect {
  background: #ef4444;
}

.legend-color.current {
  background: #6366f1;
}

.grid-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
  gap: 8px;
  margin-bottom: 24px;
}

.grid-item {
  width: 40px;
  height: 40px;
  border: 2px solid #e5e7eb;
  border-radius: 6px;
  background: white;
  color: #6b7280;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.grid-item:hover {
  border-color: #6366f1;
  transform: scale(1.05);
}

.grid-item.current {
  background: #6366f1;
  border-color: #6366f1;
  color: white;
}

.grid-item.answered {
  background: #f3f4f6;
  border-color: #d1d5db;
  color: #374151;
}

.grid-item.correct {
  background: #10b981;
  border-color: #10b981;
  color: white;
}

.grid-item.incorrect {
  background: #ef4444;
  border-color: #ef4444;
  color: white;
}

.grid-item.unanswered {
  background: white;
  border-color: #e5e7eb;
  color: #9ca3af;
}

.quick-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 16px;
  padding: 20px;
  background: #f8faff;
  border-radius: 8px;
  margin-bottom: 24px;
}

.stat-item {
  text-align: center;
}

.stat-number {
  font-size: 24px;
  font-weight: 700;
  color: #1f2937;
  margin-bottom: 4px;
}

.stat-number.correct {
  color: #10b981;
}

.stat-number.incorrect {
  color: #ef4444;
}

.stat-number.percentage {
  color: #6366f1;
}

.stat-label {
  font-size: 12px;
  color: #6b7280;
  font-weight: 500;
}

.subject-progress {
  margin-top: 24px;
}

.subject-progress h4 {
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 16px;
}

.subject-item {
  margin-bottom: 16px;
  padding: 16px;
  background: #f8faff;
  border-radius: 8px;
}

.subject-name {
  font-size: 14px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 8px;
}

.subject-stats {
  display: flex;
  align-items: center;
  gap: 12px;
}

.subject-score {
  font-size: 14px;
  font-weight: 600;
  color: #6366f1;
  min-width: 48px;
}

.subject-bar-container {
  flex: 1;
  height: 6px;
  background: #e5e7eb;
  border-radius: 3px;
  overflow: hidden;
}

.subject-bar {
  height: 100%;
  background: #6366f1;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.subject-percentage {
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
  min-width: 40px;
  text-align: right;
}

/* Responsive design */
@media (max-width: 768px) {
  .quiz-progress {
    padding: 16px;
  }

  .progress-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .legend {
    gap: 12px;
  }

  .grid-container {
    grid-template-columns: repeat(auto-fill, minmax(35px, 1fr));
    gap: 6px;
  }

  .grid-item {
    width: 35px;
    height: 35px;
    font-size: 11px;
  }

  .quick-stats {
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    padding: 16px;
  }

  .subject-stats {
    flex-direction: column;
    gap: 8px;
    align-items: stretch;
  }

  .subject-score,
  .subject-percentage {
    text-align: center;
  }
}
</style>