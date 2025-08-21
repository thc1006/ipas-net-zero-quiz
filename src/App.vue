<template>
  <div id="app">
    <!-- Application Header -->
    <header class="app-header">
      <div class="header-content">
        <div class="header-badge">iPAS 認證準備</div>
        <h1 class="header-title">
          <span class="title-icon">🎯</span>
          淨零碳備考神器
        </h1>
        <p class="header-subtitle">iPAS 淨零碳規劃管理師 考古題線上測驗</p>
        <div class="header-decoration">
          <span class="decoration-dot"></span>
          <span class="decoration-line"></span>
          <span class="decoration-dot"></span>
        </div>
      </div>
    </header>

    <!-- Main Container -->
    <main class="main-container">
      <PortalView v-if="currentView === 'portal'" @start-quiz="startQuiz" />
      <QuizView 
        v-if="currentView === 'quiz'" 
        :mode="currentQuizMode"
        :selected-category="selectedCategory"
        @back-to-portal="goBackToPortal" 
      />
    </main>

    <!-- Footer -->
    <footer class="app-footer">
      <p>© 2024 淨零碳備考神器 | 為您的專業認證之路加油！</p>
    </footer>
  </div>
</template>

<script setup>
import { ref } from 'vue'
// Import components
import PortalView from './components/PortalView.vue'
import QuizView from './components/QuizView.vue'

// Current view state
const currentView = ref('portal')
const currentQuizMode = ref('practice')
const selectedCategory = ref(null)

// Navigation methods
function startQuiz(options = {}) {
  currentQuizMode.value = options.mode || 'practice'
  selectedCategory.value = options.selectedCategory || null
  currentView.value = 'quiz'
}

function goBackToPortal() {
  currentView.value = 'portal'
}
</script>

<style>
/* Reset and Base Styles */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', '微軟正黑體', 'Roboto', 'Helvetica Neue', Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  line-height: 1.6;
  color: #2d3748;
}

/* App Container */
#app {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  position: relative;
  overflow-x: hidden;
}

#app::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-image: 
    radial-gradient(circle at 20% 80%, rgba(255, 255, 255, 0.1) 0%, transparent 50%),
    radial-gradient(circle at 80% 20%, rgba(255, 255, 255, 0.08) 0%, transparent 50%),
    radial-gradient(circle at 40% 40%, rgba(255, 255, 255, 0.05) 0%, transparent 50%);
  pointer-events: none;
}

/* Header Styles */
.app-header {
  position: relative;
  padding: 60px 20px 50px;
  text-align: center;
  color: white;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.1) 0%, transparent 100%);
  animation: fadeInDown 0.8s ease-out;
}

@keyframes fadeInDown {
  from {
    opacity: 0;
    transform: translateY(-30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.header-content {
  max-width: 800px;
  margin: 0 auto;
}

.header-badge {
  display: inline-block;
  padding: 8px 20px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 30px;
  font-size: 0.9rem;
  font-weight: 600;
  letter-spacing: 0.5px;
  margin-bottom: 20px;
  backdrop-filter: blur(10px);
  animation: slideIn 0.8s ease-out 0.2s both;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.header-title {
  font-size: 3rem;
  font-weight: 800;
  margin-bottom: 15px;
  letter-spacing: -1px;
  text-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 15px;
  animation: slideIn 0.8s ease-out 0.4s both;
}

.title-icon {
  font-size: 2.5rem;
  animation: bounce 2s infinite;
}

@keyframes bounce {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

.header-subtitle {
  font-size: 1.3rem;
  font-weight: 400;
  opacity: 0.95;
  letter-spacing: 0.5px;
  animation: slideIn 0.8s ease-out 0.6s both;
}

.header-decoration {
  margin-top: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 15px;
  animation: slideIn 0.8s ease-out 0.8s both;
}

.decoration-dot {
  width: 8px;
  height: 8px;
  background: white;
  border-radius: 50%;
  opacity: 0.8;
}

.decoration-line {
  width: 60px;
  height: 2px;
  background: linear-gradient(90deg, transparent, white, transparent);
  opacity: 0.6;
}

/* Main Container */
.main-container {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 40px 20px 80px;
  min-height: calc(100vh - 300px);
  animation: fadeInUp 0.8s ease-out 1s both;
}

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

/* Footer Styles */
.app-footer {
  position: relative;
  padding: 30px 20px;
  text-align: center;
  color: white;
  background: linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.1) 100%);
  margin-top: auto;
}

.app-footer p {
  opacity: 0.9;
  font-size: 0.95rem;
  letter-spacing: 0.3px;
}

/* Responsive Design */
@media (max-width: 768px) {
  .app-header {
    padding: 40px 20px 35px;
  }

  .header-title {
    font-size: 2.2rem;
    flex-direction: column;
    gap: 10px;
  }

  .title-icon {
    font-size: 2rem;
  }

  .header-subtitle {
    font-size: 1.1rem;
    padding: 0 20px;
  }

  .main-container {
    padding: 30px 15px 60px;
  }
}

@media (max-width: 480px) {
  .header-title {
    font-size: 1.8rem;
  }

  .header-subtitle {
    font-size: 1rem;
  }

  .header-badge {
    font-size: 0.85rem;
    padding: 6px 16px;
  }
}

/* Loading Animation */
@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}

/* Smooth Scrollbar */
::-webkit-scrollbar {
  width: 12px;
}

::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.1);
}

::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.3);
  border-radius: 6px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.4);
}

/* Selection Colors */
::selection {
  background: rgba(102, 126, 234, 0.3);
  color: white;
}

::-moz-selection {
  background: rgba(102, 126, 234, 0.3);
  color: white;
}
</style>