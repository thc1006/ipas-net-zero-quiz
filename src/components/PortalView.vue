<template>
  <div class="portal-view">
    <!-- Hero Section -->
    <section class="hero-section">
      <div class="hero-content">
        <div class="hero-icon-wrapper">
          <div class="hero-icon">🎯</div>
          <div class="icon-pulse"></div>
        </div>
        <h1 class="hero-title">iPAS 淨零碳備考神器</h1>
        <p class="hero-subtitle">專業認證，智能學習，讓您輕鬆掌握淨零碳規劃管理知識</p>
        <div class="hero-stats">
          <div class="stat-item">
            <span class="stat-number">{{ totalQuestions }}</span>
            <span class="stat-label">題庫題目</span>
          </div>
          <div class="stat-divider"></div>
          <div class="stat-item">
            <span class="stat-number">{{ completedSessions }}</span>
            <span class="stat-label">完成場次</span>
          </div>
          <div class="stat-divider"></div>
          <div class="stat-item">
            <span class="stat-number">{{ averageScore }}%</span>
            <span class="stat-label">平均分數</span>
          </div>
        </div>
        
        <!-- Visitor Counter Section -->
        <div class="visitor-stats">
          <div class="visitor-counter">
            <div class="visitor-icon">👁️</div>
            <div class="visitor-info">
              <div class="visitor-main">
                <span class="visitor-number">{{ animatedTotalVisits }}</span>
                <span class="visitor-label">總瀏覽次數</span>
              </div>
              <div class="visitor-details">
                <div class="detail-item">
                  <span class="detail-icon">👥</span>
                  <span class="detail-text">獨立訪客 {{ animatedUniqueVisitors }}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-icon">📅</span>
                  <span class="detail-text">今日 {{ animatedTodayVisits }} 次</span>
                </div>
                <div class="detail-item" v-if="isReturnVisitor">
                  <span class="detail-icon">🔄</span>
                  <span class="detail-text">您的第 {{ animatedUserVisits }} 次造訪</span>
                </div>
                <div class="detail-item" v-else>
                  <span class="detail-icon">🎉</span>
                  <span class="detail-text">歡迎首次造訪！</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Quiz Mode Cards -->
    <section class="quiz-modes">
      <h2 class="section-title">選擇學習模式</h2>
      <div class="mode-cards">
        <!-- Practice Mode -->
        <div class="mode-card practice-card" @click="startMode('practice')">
          <div class="card-icon">📚</div>
          <h3 class="card-title">練習模式</h3>
          <p class="card-description">立即反饋，詳細解析，輕鬆學習每一題</p>
          <div class="card-features">
            <div class="feature-item">
              <span class="feature-icon">✓</span>
              <span>即時答題反饋</span>
            </div>
            <div class="feature-item">
              <span class="feature-icon">✓</span>
              <span>詳細解題說明</span>
            </div>
            <div class="feature-item">
              <span class="feature-icon">✓</span>
              <span>無時間限制</span>
            </div>
          </div>
          <button class="mode-button practice-button">
            <span>開始練習</span>
            <span class="button-arrow">→</span>
          </button>
        </div>

        <!-- Exam Mode -->
        <div class="mode-card exam-card" @click="startMode('exam')">
          <div class="card-icon">⏱️</div>
          <h3 class="card-title">考試模式</h3>
          <p class="card-description">模擬真實考試環境，檢驗學習成果</p>
          <div class="card-features">
            <div class="feature-item">
              <span class="feature-icon">✓</span>
              <span>計時答題</span>
            </div>
            <div class="feature-item">
              <span class="feature-icon">✓</span>
              <span>完整成績報告</span>
            </div>
            <div class="feature-item">
              <span class="feature-icon">✓</span>
              <span>真實考試體驗</span>
            </div>
          </div>
          <button class="mode-button exam-button">
            <span>模擬考試</span>
            <span class="button-arrow">→</span>
          </button>
        </div>

        <!-- Category Mode -->
        <div class="mode-card category-card" @click="startMode('category')">
          <div class="card-icon">🏷️</div>
          <h3 class="card-title">分類練習</h3>
          <p class="card-description">針對特定主題深度練習，強化弱點</p>
          <div class="card-features">
            <div class="feature-item">
              <span class="feature-icon">✓</span>
              <span>主題分類學習</span>
            </div>
            <div class="feature-item">
              <span class="feature-icon">✓</span>
              <span>弱點強化訓練</span>
            </div>
            <div class="feature-item">
              <span class="feature-icon">✓</span>
              <span>進度追蹤</span>
            </div>
          </div>
          <button class="mode-button category-button">
            <span>分類學習</span>
            <span class="button-arrow">→</span>
          </button>
        </div>

        <!-- Study Mode -->
        <div class="mode-card study-card" @click="startMode('study')">
          <div class="card-icon">📖</div>
          <h3 class="card-title">學習模式</h3>
          <p class="card-description">瀏覽所有題目與解答，系統性學習</p>
          <div class="card-features">
            <div class="feature-item">
              <span class="feature-icon">✓</span>
              <span>完整題庫瀏覽</span>
            </div>
            <div class="feature-item">
              <span class="feature-icon">✓</span>
              <span>詳細解題過程</span>
            </div>
            <div class="feature-item">
              <span class="feature-icon">✓</span>
              <span>知識點整理</span>
            </div>
          </div>
          <button class="mode-button study-button">
            <span>開始學習</span>
            <span class="button-arrow">→</span>
          </button>
        </div>
      </div>
    </section>

    <!-- Statistics Dashboard -->
    <section class="statistics-section" v-if="hasUserData">
      <h2 class="section-title">學習統計</h2>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-icon">📊</span>
            <span class="stat-title">總體表現</span>
          </div>
          <div class="stat-value">{{ averageScore }}%</div>
          <div class="stat-trend positive" v-if="scoreTrend > 0">
            <span class="trend-icon">↗️</span>
            <span>較上次提升 {{ scoreTrend }}%</span>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-icon">🏆</span>
            <span class="stat-title">最佳成績</span>
          </div>
          <div class="stat-value">{{ bestScore }}%</div>
          <div class="stat-subtitle">{{ bestScoreDate }}</div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-icon">⚡</span>
            <span class="stat-title">連續答對</span>
          </div>
          <div class="stat-value">{{ longestStreak }}</div>
          <div class="stat-subtitle">最長紀錄</div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-icon">📈</span>
            <span class="stat-title">學習天數</span>
          </div>
          <div class="stat-value">{{ studyDays }}</div>
          <div class="stat-subtitle">累積學習</div>
        </div>
      </div>
    </section>

    <!-- Quick Settings -->
    <section class="settings-section">
      <h2 class="section-title">快速設定</h2>
      <div class="settings-grid">
        <div class="setting-item">
          <div class="setting-info">
            <span class="setting-icon">🔊</span>
            <div class="setting-details">
              <div class="setting-label">音效提示</div>
              <div class="setting-description">答題音效與提示音</div>
            </div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" v-model="settings.soundEnabled">
            <span class="toggle-slider"></span>
          </label>
        </div>

        <div class="setting-item">
          <div class="setting-info">
            <span class="setting-icon">🌙</span>
            <div class="setting-details">
              <div class="setting-label">深色模式</div>
              <div class="setting-description">護眼深色界面</div>
            </div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" v-model="settings.darkMode">
            <span class="toggle-slider"></span>
          </label>
        </div>

        <div class="setting-item">
          <div class="setting-info">
            <span class="setting-icon">💾</span>
            <div class="setting-details">
              <div class="setting-label">自動儲存</div>
              <div class="setting-description">自動保存學習進度</div>
            </div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" v-model="settings.autoSave" checked>
            <span class="toggle-slider"></span>
          </label>
        </div>

        <div class="setting-item">
          <div class="setting-info">
            <span class="setting-icon">⚡</span>
            <div class="setting-details">
              <div class="setting-label">快速模式</div>
              <div class="setting-description">減少動畫效果</div>
            </div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" v-model="settings.fastMode">
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    </section>

    <!-- About Section -->
    <section class="about-section">
      <h2 class="section-title">關於 iPAS 淨零碳規劃管理師</h2>
      <div class="about-content">
        <div class="about-card">
          <div class="about-icon">🎯</div>
          <h3>認證目標</h3>
          <p>培養具備淨零碳排規劃與管理專業能力的人才，協助企業達成永續發展目標。</p>
        </div>
        
        <div class="about-card">
          <div class="about-icon">📚</div>
          <h3>考試內容</h3>
          <p>涵蓋淨零碳基礎概論、碳盤查實務、減碳策略規劃等核心知識領域。</p>
        </div>
        
        <div class="about-card">
          <div class="about-icon">🏆</div>
          <h3>職涯發展</h3>
          <p>取得認證後可從事ESG顧問、碳管理專員、永續發展規劃師等相關工作。</p>
        </div>
      </div>
    </section>

    <!-- Call to Action -->
    <section class="cta-section">
      <div class="cta-content">
        <h2 class="cta-title">開始您的學習之旅</h2>
        <p class="cta-subtitle">選擇適合的學習模式，系統性掌握淨零碳規劃管理知識</p>
        <button class="cta-button" @click="startMode('practice')">
          <span>立即開始練習</span>
          <span class="cta-arrow">🚀</span>
        </button>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useVisitorTracking } from '../composables/useVisitorTracking.js'
import { useCountUp } from '../composables/useCountUp.js'

// Props
const emit = defineEmits(['start-quiz'])

// Visitor tracking
const {
  totalVisits,
  uniqueVisitors,
  todayVisits,
  userVisits,
  isReturnVisitor
} = useVisitorTracking()

// Count-up animations for visitor stats
const { current: animatedTotalVisits } = useCountUp(totalVisits, { duration: 2000, delay: 800 })
const { current: animatedUniqueVisitors } = useCountUp(uniqueVisitors, { duration: 1800, delay: 1000 })
const { current: animatedTodayVisits } = useCountUp(todayVisits, { duration: 1500, delay: 1200 })
const { current: animatedUserVisits } = useCountUp(userVisits, { duration: 1200, delay: 1400 })

// Reactive data
const totalQuestions = ref(150)
const completedSessions = ref(12)
const averageScore = ref(78)
const bestScore = ref(92)
const bestScoreDate = ref('2024-08-15')
const longestStreak = ref(15)
const studyDays = ref(28)
const scoreTrend = ref(5)

const settings = ref({
  soundEnabled: true,
  darkMode: false,
  autoSave: true,
  fastMode: false
})

// Computed properties
const hasUserData = computed(() => {
  return completedSessions.value > 0
})

// Methods
function startMode(mode) {
  console.log(`Starting ${mode} mode`)
  
  // For category mode, show category selection
  if (mode === 'category') {
    showCategorySelection()
    return
  }
  
  // Emit event to parent component to start the quiz
  emit('start-quiz', { mode })
}

// Function to show category selection dialog
function showCategorySelection() {
  // Create a simple category selection using confirm dialogs
  // In a real app, you might want a proper modal dialog
  const categories = [
    { key: '考科一', name: '考科一：淨零碳規劃管理基礎概論' },
    { key: '考科二', name: '考科二：淨零碳盤查範圍與程序概要' }
  ]
  
  const choice = confirm('請選擇練習類別：\n\n1. 考科一：淨零碳規劃管理基礎概論\n2. 考科二：淨零碳盤查範圍與程序概要\n\n點擊「確定」選擇考科一，點擊「取消」選擇考科二')
  
  const selectedCategory = choice ? '考科一' : '考科二'
  
  // Start quiz with selected category
  emit('start-quiz', { mode: 'category', selectedCategory })
}

// Lifecycle
onMounted(() => {
  // Load user data from localStorage if available
  const userData = localStorage.getItem('ipas-quiz-data')
  if (userData) {
    const data = JSON.parse(userData)
    completedSessions.value = data.completedSessions || 0
    averageScore.value = data.averageScore || 0
    bestScore.value = data.bestScore || 0
    longestStreak.value = data.longestStreak || 0
    studyDays.value = data.studyDays || 0
  }
  
  // Load settings
  const savedSettings = localStorage.getItem('ipas-quiz-settings')
  if (savedSettings) {
    settings.value = { ...settings.value, ...JSON.parse(savedSettings) }
  }
})

// Watch settings changes and save to localStorage
function saveSettings() {
  localStorage.setItem('ipas-quiz-settings', JSON.stringify(settings.value))
}

// Auto-save settings when changed
watch(settings, saveSettings, { deep: true })
</script>

<style scoped>
.portal-view {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 20px;
}

/* Hero Section */
.hero-section {
  text-align: center;
  padding: 60px 0;
  position: relative;
}

.hero-content {
  max-width: 800px;
  margin: 0 auto;
}

.hero-icon-wrapper {
  position: relative;
  display: inline-block;
  margin-bottom: 30px;
}

.hero-icon {
  font-size: 4rem;
  display: block;
  position: relative;
  z-index: 2;
  animation: bounce 3s infinite;
}

.icon-pulse {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 80px;
  height: 80px;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.3) 0%, transparent 70%);
  border-radius: 50%;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% { transform: translate(-50%, -50%) scale(1); opacity: 0.7; }
  50% { transform: translate(-50%, -50%) scale(1.2); opacity: 0.4; }
  100% { transform: translate(-50%, -50%) scale(1); opacity: 0.7; }
}

.hero-title {
  font-size: 3.5rem;
  font-weight: 800;
  color: white;
  margin-bottom: 20px;
  text-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  animation: fadeInUp 0.8s ease-out 0.2s both;
}

.hero-subtitle {
  font-size: 1.4rem;
  color: rgba(255, 255, 255, 0.95);
  margin-bottom: 40px;
  line-height: 1.6;
  animation: fadeInUp 0.8s ease-out 0.4s both;
}

.hero-stats {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 30px;
  margin-top: 50px;
  animation: fadeInUp 0.8s ease-out 0.6s both;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}

.stat-number {
  font-size: 2rem;
  font-weight: 700;
  color: white;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
}

.stat-label {
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.8);
  font-weight: 500;
}

.stat-divider {
  width: 1px;
  height: 40px;
  background: linear-gradient(to bottom, transparent, rgba(255, 255, 255, 0.3), transparent);
}

/* Visitor Counter Styles */
.visitor-stats {
  margin-top: 40px;
  animation: fadeInUp 0.8s ease-out 0.8s both;
}

.visitor-counter {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 20px;
  padding: 25px 30px;
  max-width: 600px;
  margin: 0 auto;
  transition: all 0.3s ease;
}

.visitor-counter:hover {
  background: rgba(255, 255, 255, 0.15);
  transform: translateY(-2px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
}

.visitor-icon {
  font-size: 3rem;
  animation: pulse 2s infinite;
  filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.2));
}

.visitor-info {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.visitor-main {
  display: flex;
  align-items: center;
  gap: 15px;
}

.visitor-number {
  font-size: 2.2rem;
  font-weight: 700;
  color: white;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
  min-width: 60px;
  text-align: left;
}

.visitor-label {
  font-size: 1.1rem;
  color: rgba(255, 255, 255, 0.9);
  font-weight: 600;
}

.visitor-details {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}

.detail-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.95rem;
  color: rgba(255, 255, 255, 0.85);
  font-weight: 500;
}

.detail-icon {
  font-size: 1rem;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2));
}

.detail-text {
  white-space: nowrap;
}

/* Quiz Modes Section */
.quiz-modes {
  margin: 80px 0;
}

.section-title {
  font-size: 2.5rem;
  font-weight: 700;
  color: white;
  text-align: center;
  margin-bottom: 50px;
  text-shadow: 0 2px 15px rgba(0, 0, 0, 0.2);
}

.mode-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 30px;
  margin-top: 40px;
}

.mode-card {
  background: white;
  border-radius: 24px;
  padding: 40px 30px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.8);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: pointer;
  position: relative;
  overflow: hidden;
}

.mode-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.4s ease;
}

.mode-card:hover {
  transform: translateY(-10px);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.15);
}

.mode-card:hover::before {
  transform: scaleX(1);
}

.card-icon {
  font-size: 3rem;
  margin-bottom: 20px;
  display: block;
}

.card-title {
  font-size: 1.8rem;
  font-weight: 700;
  color: #1a202c;
  margin-bottom: 15px;
}

.card-description {
  font-size: 1.1rem;
  color: #4a5568;
  line-height: 1.6;
  margin-bottom: 25px;
}

.card-features {
  margin-bottom: 30px;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  font-size: 0.95rem;
  color: #2d3748;
}

.feature-icon {
  color: #48bb78;
  font-weight: bold;
  font-size: 0.9rem;
}

.mode-button {
  width: 100%;
  padding: 15px 25px;
  border: none;
  border-radius: 16px;
  font-size: 1.1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  box-shadow: 0 4px 20px rgba(102, 126, 234, 0.3);
}

.mode-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 30px rgba(102, 126, 234, 0.4);
}

.button-arrow {
  transition: transform 0.3s ease;
}

.mode-button:hover .button-arrow {
  transform: translateX(3px);
}

/* Statistics Section */
.statistics-section {
  margin: 80px 0;
  padding: 50px 40px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(10px);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 25px;
  margin-top: 40px;
}

.stat-card {
  background: white;
  border-radius: 16px;
  padding: 25px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
}

.stat-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 15px;
}

.stat-icon {
  font-size: 1.3rem;
}

.stat-title {
  font-size: 1rem;
  font-weight: 600;
  color: #4a5568;
}

.stat-value {
  font-size: 2.2rem;
  font-weight: 700;
  color: #1a202c;
  margin-bottom: 5px;
}

.stat-subtitle {
  font-size: 0.9rem;
  color: #718096;
}

.stat-trend {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.9rem;
  font-weight: 500;
}

.stat-trend.positive {
  color: #38a169;
}

/* Settings Section */
.settings-section {
  margin: 80px 0;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px;
  margin-top: 40px;
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: white;
  border-radius: 16px;
  padding: 20px 25px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
  border: 1px solid rgba(0, 0, 0, 0.05);
}

.setting-info {
  display: flex;
  align-items: center;
  gap: 15px;
}

.setting-icon {
  font-size: 1.5rem;
}

.setting-details {
  display: flex;
  flex-direction: column;
}

.setting-label {
  font-size: 1.1rem;
  font-weight: 600;
  color: #1a202c;
  margin-bottom: 2px;
}

.setting-description {
  font-size: 0.9rem;
  color: #718096;
}

/* Toggle Switch */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 50px;
  height: 28px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #cbd5e0;
  transition: 0.3s;
  border-radius: 28px;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 22px;
  width: 22px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.3s;
  border-radius: 50%;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

input:checked + .toggle-slider {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

input:checked + .toggle-slider:before {
  transform: translateX(22px);
}

/* About Section */
.about-section {
  margin: 80px 0;
}

.about-content {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 30px;
  margin-top: 40px;
}

.about-card {
  background: white;
  border-radius: 20px;
  padding: 35px 30px;
  text-align: center;
  box-shadow: 0 15px 40px rgba(0, 0, 0, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.8);
  transition: transform 0.3s ease;
}

.about-card:hover {
  transform: translateY(-5px);
}

.about-icon {
  font-size: 3rem;
  margin-bottom: 20px;
}

.about-card h3 {
  font-size: 1.5rem;
  font-weight: 700;
  color: #1a202c;
  margin-bottom: 15px;
}

.about-card p {
  font-size: 1.05rem;
  color: #4a5568;
  line-height: 1.6;
}

/* CTA Section */
.cta-section {
  margin: 80px 0;
  padding: 60px 40px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.15) 0%, rgba(255, 255, 255, 0.05) 100%);
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  text-align: center;
  backdrop-filter: blur(10px);
}

.cta-title {
  font-size: 2.5rem;
  font-weight: 700;
  color: white;
  margin-bottom: 15px;
  text-shadow: 0 2px 15px rgba(0, 0, 0, 0.2);
}

.cta-subtitle {
  font-size: 1.2rem;
  color: rgba(255, 255, 255, 0.9);
  margin-bottom: 40px;
  line-height: 1.6;
}

.cta-button {
  display: inline-flex;
  align-items: center;
  gap: 15px;
  padding: 20px 40px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 16px;
  font-size: 1.3rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 10px 40px rgba(102, 126, 234, 0.3);
}

.cta-button:hover {
  transform: translateY(-5px);
  box-shadow: 0 20px 60px rgba(102, 126, 234, 0.4);
}

.cta-arrow {
  font-size: 1.5rem;
  transition: transform 0.3s ease;
}

.cta-button:hover .cta-arrow {
  transform: translateX(5px);
}

/* Animation keyframes */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes bounce {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

/* Responsive Design */
@media (max-width: 768px) {
  .portal-view {
    padding: 0 15px;
  }

  .hero-title {
    font-size: 2.5rem;
  }

  .hero-subtitle {
    font-size: 1.2rem;
  }

  .hero-stats {
    flex-direction: column;
    gap: 20px;
  }

  .stat-divider {
    width: 40px;
    height: 1px;
    background: linear-gradient(to right, transparent, rgba(255, 255, 255, 0.3), transparent);
  }

  .visitor-counter {
    flex-direction: column;
    gap: 15px;
    padding: 20px 25px;
    text-align: center;
  }

  .visitor-main {
    flex-direction: column;
    gap: 8px;
  }

  .visitor-details {
    gap: 15px;
    justify-content: center;
  }

  .detail-item {
    font-size: 0.9rem;
  }

  .section-title {
    font-size: 2rem;
  }

  .mode-cards {
    grid-template-columns: 1fr;
    gap: 20px;
  }

  .mode-card {
    padding: 30px 25px;
  }

  .stats-grid {
    grid-template-columns: 1fr;
    gap: 20px;
  }

  .settings-grid {
    grid-template-columns: 1fr;
    gap: 15px;
  }

  .about-content {
    grid-template-columns: 1fr;
    gap: 25px;
  }

  .cta-section {
    padding: 40px 25px;
  }

  .cta-title {
    font-size: 2rem;
  }

  .cta-subtitle {
    font-size: 1.1rem;
  }

  .cta-button {
    padding: 16px 32px;
    font-size: 1.1rem;
  }
}

@media (max-width: 480px) {
  .hero-title {
    font-size: 2rem;
  }

  .hero-subtitle {
    font-size: 1rem;
  }

  .section-title {
    font-size: 1.7rem;
  }

  .visitor-counter {
    padding: 18px 20px;
  }

  .visitor-number {
    font-size: 1.8rem;
  }

  .visitor-label {
    font-size: 1rem;
  }

  .visitor-details {
    flex-direction: column;
    gap: 10px;
  }

  .detail-item {
    font-size: 0.85rem;
  }

  .mode-card {
    padding: 25px 20px;
  }

  .card-title {
    font-size: 1.5rem;
  }

  .cta-title {
    font-size: 1.7rem;
  }
}
</style>