<template>
  <div class="results-view">
    <!-- Completion Icon -->
    <div class="completion-icon">
      <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="60" cy="60" r="58" stroke="url(#gradient)" stroke-width="4"/>
        <path d="M35 60L50 75L85 40" stroke="url(#gradient)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
        <defs>
          <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
          </linearGradient>
        </defs>
      </svg>
    </div>

    <!-- Completion Message -->
    <h1 class="completion-title">測驗完成！</h1>
    
    <!-- Score Display -->
    <div class="score-container">
      <p class="score-text">你的最終成績</p>
      <div class="score-display">
        <span class="score-number">{{ score }}</span>
        <span class="score-divider">/</span>
        <span class="total-number">{{ totalQuestions }}</span>
      </div>
      
      <!-- Score Percentage -->
      <div class="score-percentage">
        <div class="percentage-text">{{ scorePercentage }}%</div>
        <div class="percentage-bar">
          <div class="percentage-fill" :style="{ width: scorePercentage + '%' }"></div>
        </div>
      </div>
      
      <!-- Performance Message -->
      <p class="performance-message">{{ performanceMessage }}</p>
    </div>

    <!-- Statistics -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon correct">✓</div>
        <div class="stat-value">{{ score }}</div>
        <div class="stat-label">正確答案</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon incorrect">✗</div>
        <div class="stat-value">{{ incorrectAnswers }}</div>
        <div class="stat-label">錯誤答案</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon accuracy">%</div>
        <div class="stat-value">{{ scorePercentage }}%</div>
        <div class="stat-label">正確率</div>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="action-buttons">
      <button @click="handleRestart" class="restart-button">
        <span class="button-icon">🔄</span>
        重新開始
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

// Props definition
const props = defineProps({
  score: {
    type: Number,
    required: true
  },
  totalQuestions: {
    type: Number,
    required: true
  }
})

// Emit definition
const emit = defineEmits(['restart'])

// Computed properties
const scorePercentage = computed(() => {
  if (props.totalQuestions === 0) return 0
  return Math.round((props.score / props.totalQuestions) * 100)
})

const incorrectAnswers = computed(() => {
  return props.totalQuestions - props.score
})

const performanceMessage = computed(() => {
  const percentage = scorePercentage.value
  if (percentage === 100) return '完美！你答對了所有題目！🎉'
  if (percentage >= 90) return '太棒了！你的表現非常優秀！🌟'
  if (percentage >= 80) return '很好！你掌握了大部分內容！👍'
  if (percentage >= 70) return '不錯！繼續努力會更好！💪'
  if (percentage >= 60) return '還可以，再多練習一下吧！📚'
  return '需要加強練習，別放棄！💡'
})

// Methods
function handleRestart() {
  emit('restart')
}
</script>

<style scoped>
.results-view {
  width: 100%;
  max-width: 600px;
  margin: 0 auto;
  padding: 40px;
  background: white;
  border-radius: 20px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.1);
  text-align: center;
  animation: fadeIn 0.5s ease-in;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Completion Icon */
.completion-icon {
  margin-bottom: 30px;
  animation: scaleIn 0.5s ease-out 0.2s both;
}

@keyframes scaleIn {
  from {
    transform: scale(0);
  }
  to {
    transform: scale(1);
  }
}

/* Title */
.completion-title {
  font-size: 2.5rem;
  font-weight: 700;
  color: #2c3e50;
  margin-bottom: 30px;
  animation: slideDown 0.5s ease-out 0.4s both;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Score Container */
.score-container {
  margin-bottom: 40px;
  animation: slideUp 0.5s ease-out 0.6s both;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.score-text {
  font-size: 1.2rem;
  color: #718096;
  margin-bottom: 15px;
}

.score-display {
  font-size: 4rem;
  font-weight: 700;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.score-number {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.score-divider {
  color: #cbd5e0;
  font-weight: 300;
}

.total-number {
  color: #4a5568;
}

/* Score Percentage */
.score-percentage {
  margin-bottom: 20px;
}

.percentage-text {
  font-size: 2rem;
  font-weight: 600;
  color: #667eea;
  margin-bottom: 10px;
}

.percentage-bar {
  width: 100%;
  height: 12px;
  background: #e2e8f0;
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 15px;
}

.percentage-fill {
  height: 100%;
  background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
  border-radius: 6px;
  transition: width 1s ease-out;
}

.performance-message {
  font-size: 1.3rem;
  color: #4a5568;
  font-weight: 500;
}

/* Statistics Grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  margin-bottom: 40px;
  animation: fadeIn 0.5s ease-out 0.8s both;
}

.stat-card {
  padding: 20px;
  background: #f7fafc;
  border-radius: 15px;
  border: 1px solid #e2e8f0;
}

.stat-icon {
  width: 40px;
  height: 40px;
  margin: 0 auto 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 1.5rem;
  font-weight: bold;
}

.stat-icon.correct {
  background: #c6f6d5;
  color: #22543d;
}

.stat-icon.incorrect {
  background: #fed7d7;
  color: #742a2a;
}

.stat-icon.accuracy {
  background: #e9d8fd;
  color: #44337a;
}

.stat-value {
  font-size: 1.8rem;
  font-weight: 700;
  color: #2c3e50;
  margin-bottom: 5px;
}

.stat-label {
  font-size: 0.9rem;
  color: #718096;
  font-weight: 500;
}

/* Action Buttons */
.action-buttons {
  animation: fadeIn 0.5s ease-out 1s both;
}

.restart-button {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 18px 40px;
  background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
  color: white;
  border: none;
  border-radius: 15px;
  font-size: 1.3rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 10px 30px rgba(72, 187, 120, 0.3);
}

.restart-button:hover {
  transform: translateY(-3px);
  box-shadow: 0 15px 40px rgba(72, 187, 120, 0.4);
}

.restart-button:active {
  transform: translateY(-1px);
}

.button-icon {
  font-size: 1.5rem;
}

/* Responsive Design */
@media (max-width: 768px) {
  .results-view {
    padding: 30px 20px;
  }

  .completion-title {
    font-size: 2rem;
  }

  .score-display {
    font-size: 3rem;
  }

  .percentage-text {
    font-size: 1.5rem;
  }

  .performance-message {
    font-size: 1.1rem;
  }

  .stats-grid {
    grid-template-columns: 1fr;
    gap: 15px;
  }

  .stat-card {
    display: flex;
    align-items: center;
    gap: 15px;
    padding: 15px;
  }

  .stat-icon {
    margin: 0;
  }

  .stat-value {
    font-size: 1.5rem;
  }

  .restart-button {
    padding: 15px 30px;
    font-size: 1.1rem;
  }
}

/* Print Styles */
@media print {
  .restart-button {
    display: none;
  }
}
</style>