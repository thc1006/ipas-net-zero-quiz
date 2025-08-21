<template>
  <div class="performance-monitor" :class="{ collapsed: isCollapsed }">
    <!-- Toggle Button -->
    <button 
      class="monitor-toggle"
      @click="toggleCollapsed"
      :aria-label="isCollapsed ? '展開效能監控' : '收合效能監控'"
    >
      {{ isCollapsed ? '📊' : '✕' }}
    </button>
    
    <!-- Performance Panel -->
    <div v-if="!isCollapsed" class="monitor-panel">
      <!-- Header -->
      <div class="monitor-header">
        <h3 class="monitor-title">效能監控</h3>
        <div class="monitor-controls">
          <button @click="refreshMetrics" class="control-button">
            🔄
          </button>
          <button @click="clearMetrics" class="control-button">
            🗑️
          </button>
          <button @click="exportMetrics" class="control-button">
            💾
          </button>
        </div>
      </div>
      
      <!-- Core Web Vitals -->
      <div class="metrics-section">
        <h4 class="section-title">Core Web Vitals</h4>
        <div class="metrics-grid">
          <div class="metric-item" :class="getMetricStatus('lcp')">
            <span class="metric-label">LCP</span>
            <span class="metric-value">{{ formatTime(metrics.lcp) }}</span>
          </div>
          <div class="metric-item" :class="getMetricStatus('fid')">
            <span class="metric-label">FID</span>
            <span class="metric-value">{{ formatTime(metrics.fid) }}</span>
          </div>
          <div class="metric-item" :class="getMetricStatus('cls')">
            <span class="metric-label">CLS</span>
            <span class="metric-value">{{ formatNumber(metrics.cls) }}</span>
          </div>
        </div>
      </div>
      
      <!-- Performance Metrics -->
      <div class="metrics-section">
        <h4 class="section-title">效能指標</h4>
        <div class="metrics-list">
          <div class="metric-row">
            <span class="metric-name">FPS</span>
            <span class="metric-value" :class="getFPSStatus(metrics.fps)">
              {{ metrics.fps || 0 }}
            </span>
          </div>
          <div class="metric-row">
            <span class="metric-name">記憶體使用</span>
            <span class="metric-value" :class="getMemoryStatus()">
              {{ formatMemory(memoryUsage?.percentage) }}
            </span>
          </div>
          <div class="metric-row">
            <span class="metric-name">快取命中率</span>
            <span class="metric-value">{{ formatPercentage(cacheHitRate) }}</span>
          </div>
        </div>
      </div>
      
      <!-- Component Performance -->
      <div class="metrics-section">
        <h4 class="section-title">組件效能</h4>
        <div class="component-metrics">
          <div 
            v-for="(time, component) in componentTimes" 
            :key="component"
            class="component-metric"
          >
            <span class="component-name">{{ component }}</span>
            <span class="component-time" :class="getComponentStatus(time)">
              {{ formatTime(time) }}
            </span>
          </div>
        </div>
      </div>
      
      <!-- Network Performance -->
      <div class="metrics-section">
        <h4 class="section-title">網路效能</h4>
        <div class="metrics-list">
          <div class="metric-row">
            <span class="metric-name">問題載入時間</span>
            <span class="metric-value">{{ formatTime(networkMetrics.questionLoadTime) }}</span>
          </div>
          <div class="metric-row">
            <span class="metric-name">快取大小</span>
            <span class="metric-value">{{ formatBytes(networkMetrics.cacheSize) }}</span>
          </div>
        </div>
      </div>
      
      <!-- Real-time Chart -->
      <div class="metrics-section">
        <h4 class="section-title">即時監控</h4>
        <div class="chart-container">
          <canvas ref="chartCanvas" class="performance-chart"></canvas>
        </div>
      </div>
      
      <!-- Recommendations -->
      <div v-if="recommendations.length > 0" class="metrics-section">
        <h4 class="section-title">效能建議</h4>
        <div class="recommendations-list">
          <div 
            v-for="(recommendation, index) in recommendations"
            :key="index"
            class="recommendation-item"
            :class="recommendation.priority"
          >
            <span class="recommendation-icon">{{ recommendation.icon }}</span>
            <span class="recommendation-text">{{ recommendation.text }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { 
  performanceMonitor, 
  memoryManager, 
  fpsMonitor,
  trackComponentPerformance
} from '@utils/performance.js'

// Component state
const isCollapsed = ref(false)
const metrics = ref({
  lcp: null,
  fid: null,
  cls: null,
  fps: 0
})

const memoryUsage = ref(null)
const componentTimes = ref({})
const networkMetrics = ref({
  questionLoadTime: null,
  cacheSize: null
})

const chartCanvas = ref(null)
const chartContext = ref(null)
const chartData = ref([])
const maxDataPoints = 50

// Update intervals
let metricsUpdateInterval = null
let chartUpdateInterval = null

// Computed properties
const cacheHitRate = computed(() => {
  const allMetrics = performanceMonitor.getAllMetrics()
  const hits = allMetrics['questions.cacheHit']?.length || 0
  const loads = allMetrics['questions.chunkLoaded']?.length || 0
  const total = hits + loads
  return total > 0 ? (hits / total) * 100 : 0
})

const recommendations = computed(() => {
  const recs = []
  
  // LCP recommendations
  if (metrics.value.lcp > 4000) {
    recs.push({
      icon: '⚠️',
      text: 'LCP 過高，考慮優化圖片載入或減少主執行緒阻塞',
      priority: 'high'
    })
  }
  
  // FPS recommendations
  if (metrics.value.fps < 30) {
    recs.push({
      icon: '🐌',
      text: 'FPS 過低，檢查動畫效能或減少 DOM 操作',
      priority: 'medium'
    })
  }
  
  // Memory recommendations
  if (memoryUsage.value?.percentage > 80) {
    recs.push({
      icon: '🧠',
      text: '記憶體使用過高，建議清理快取或優化資料結構',
      priority: 'high'
    })
  }
  
  // Cache recommendations
  if (cacheHitRate.value < 50) {
    recs.push({
      icon: '💾',
      text: '快取命中率偏低，檢查快取策略設定',
      priority: 'low'
    })
  }
  
  return recs
})

// Lifecycle hooks
onMounted(() => {
  initializeMonitoring()
  setupChart()
  startPeriodicUpdates()
})

onUnmounted(() => {
  cleanup()
})

// Methods
const initializeMonitoring = () => {
  // Listen for performance metrics
  if (typeof window !== 'undefined') {
    window.addEventListener('performance-metric', handleMetricUpdate)
  }
  
  // Initial metrics fetch
  refreshMetrics()
}

const handleMetricUpdate = (event) => {
  const { name, value } = event.detail
  
  // Update relevant metrics
  if (name === 'lcp') {
    metrics.value.lcp = value
  } else if (name === 'fid') {
    metrics.value.fid = value
  } else if (name === 'cls') {
    metrics.value.cls = value
  } else if (name === 'fps') {
    metrics.value.fps = value
    updateChart('fps', value)
  }
  
  // Component metrics
  if (name.startsWith('component.')) {
    const componentName = name.split('.')[1]
    componentTimes.value[componentName] = value
  }
  
  // Network metrics
  if (name.startsWith('async.questionLoader')) {
    networkMetrics.value.questionLoadTime = value
  }
}

const refreshMetrics = () => {
  const tracker = trackComponentPerformance('PerformanceMonitor', 'refreshMetrics')
  
  try {
    // Get all metrics from performance monitor
    const allMetrics = performanceMonitor.getAllMetrics()
    
    // Update core web vitals
    if (allMetrics.lcp?.length > 0) {
      metrics.value.lcp = allMetrics.lcp[allMetrics.lcp.length - 1].value
    }
    
    if (allMetrics.fid?.length > 0) {
      metrics.value.fid = allMetrics.fid[allMetrics.fid.length - 1].value
    }
    
    if (allMetrics.cls?.length > 0) {
      metrics.value.cls = allMetrics.cls[allMetrics.cls.length - 1].value
    }
    
    // Update FPS
    metrics.value.fps = fpsMonitor.getFPS()
    
    // Update memory usage
    memoryUsage.value = memoryManager.getMemoryUsage()
    
    // Update component times
    Object.keys(allMetrics).forEach(key => {
      if (key.startsWith('component.')) {
        const parts = key.split('.')
        if (parts.length >= 2) {
          const componentName = parts[1]
          const metricData = allMetrics[key]
          if (metricData.length > 0) {
            componentTimes.value[componentName] = metricData[metricData.length - 1].value
          }
        }
      }
    })
    
    tracker.end()
    
  } catch (error) {
    tracker.end({ error: error.message })
    console.error('Failed to refresh metrics:', error)
  }
}

const clearMetrics = () => {
  performanceMonitor.clearMetrics()
  metrics.value = { lcp: null, fid: null, cls: null, fps: 0 }
  componentTimes.value = {}
  networkMetrics.value = { questionLoadTime: null, cacheSize: null }
  chartData.value = []
}

const exportMetrics = () => {
  const data = {
    timestamp: new Date().toISOString(),
    metrics: metrics.value,
    componentTimes: componentTimes.value,
    networkMetrics: networkMetrics.value,
    memoryUsage: memoryUsage.value,
    recommendations: recommendations.value,
    allMetrics: performanceMonitor.getAllMetrics()
  }
  
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  
  const a = document.createElement('a')
  a.href = url
  a.download = `performance-metrics-${Date.now()}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  
  URL.revokeObjectURL(url)
}

const toggleCollapsed = () => {
  isCollapsed.value = !isCollapsed.value
}

const setupChart = async () => {
  await nextTick()
  
  if (chartCanvas.value) {
    chartContext.value = chartCanvas.value.getContext('2d')
    chartCanvas.value.width = 250
    chartCanvas.value.height = 100
    drawChart()
  }
}

const updateChart = (metric, value) => {
  chartData.value.push({ time: Date.now(), value })
  
  if (chartData.value.length > maxDataPoints) {
    chartData.value.shift()
  }
  
  drawChart()
}

const drawChart = () => {
  if (!chartContext.value || chartData.value.length === 0) return
  
  const ctx = chartContext.value
  const canvas = chartCanvas.value
  
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  
  // Setup
  const padding = 10
  const width = canvas.width - padding * 2
  const height = canvas.height - padding * 2
  
  if (chartData.value.length < 2) return
  
  // Find min/max values
  const values = chartData.value.map(d => d.value)
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const range = maxValue - minValue || 1
  
  // Draw grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
  ctx.lineWidth = 1
  
  // Horizontal grid lines
  for (let i = 0; i <= 4; i++) {
    const y = padding + (height / 4) * i
    ctx.beginPath()
    ctx.moveTo(padding, y)
    ctx.lineTo(canvas.width - padding, y)
    ctx.stroke()
  }
  
  // Draw data line
  ctx.strokeStyle = '#4ade80'
  ctx.lineWidth = 2
  ctx.beginPath()
  
  chartData.value.forEach((point, index) => {
    const x = padding + (width / (chartData.value.length - 1)) * index
    const y = padding + height - ((point.value - minValue) / range) * height
    
    if (index === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  })
  
  ctx.stroke()
  
  // Draw current value
  ctx.fillStyle = 'white'
  ctx.font = '12px monospace'
  ctx.textAlign = 'right'
  ctx.fillText(
    `${Math.round(values[values.length - 1])}`, 
    canvas.width - padding, 
    padding + 15
  )
}

const startPeriodicUpdates = () => {
  metricsUpdateInterval = setInterval(refreshMetrics, 2000)
  chartUpdateInterval = setInterval(() => {
    updateChart('fps', fpsMonitor.getFPS())
  }, 1000)
}

const cleanup = () => {
  if (metricsUpdateInterval) {
    clearInterval(metricsUpdateInterval)
  }
  
  if (chartUpdateInterval) {
    clearInterval(chartUpdateInterval)
  }
  
  if (typeof window !== 'undefined') {
    window.removeEventListener('performance-metric', handleMetricUpdate)
  }
}

// Utility methods
const formatTime = (ms) => {
  if (ms === null || ms === undefined) return 'N/A'
  if (ms < 1) return `${(ms * 1000).toFixed(1)}μs`
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

const formatNumber = (num) => {
  if (num === null || num === undefined) return 'N/A'
  return Number(num).toFixed(3)
}

const formatMemory = (percentage) => {
  if (percentage === null || percentage === undefined) return 'N/A'
  return `${Math.round(percentage)}%`
}

const formatPercentage = (num) => {
  if (num === null || num === undefined) return 'N/A'
  return `${Math.round(num)}%`
}

const formatBytes = (bytes) => {
  if (!bytes) return '0 B'
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`
}

const getMetricStatus = (metric) => {
  const value = metrics.value[metric]
  if (value === null || value === undefined) return 'unknown'
  
  switch (metric) {
    case 'lcp':
      return value <= 2500 ? 'good' : value <= 4000 ? 'needs-improvement' : 'poor'
    case 'fid':
      return value <= 100 ? 'good' : value <= 300 ? 'needs-improvement' : 'poor'
    case 'cls':
      return value <= 0.1 ? 'good' : value <= 0.25 ? 'needs-improvement' : 'poor'
    default:
      return 'unknown'
  }
}

const getFPSStatus = (fps) => {
  if (fps >= 50) return 'good'
  if (fps >= 30) return 'needs-improvement'
  return 'poor'
}

const getMemoryStatus = () => {
  const usage = memoryUsage.value
  if (!usage) return 'unknown'
  
  if (usage.percentage <= 50) return 'good'
  if (usage.percentage <= 80) return 'needs-improvement'
  return 'poor'
}

const getComponentStatus = (time) => {
  if (time <= 16) return 'good' // Under 16ms for 60fps
  if (time <= 33) return 'needs-improvement' // Under 33ms for 30fps
  return 'poor'
}
</script>

<style scoped>
.performance-monitor {
  position: fixed;
  top: 10px;
  right: 10px;
  background: rgba(0, 0, 0, 0.9);
  border-radius: 8px;
  color: white;
  font-family: 'Monaco', 'Consolas', monospace;
  font-size: 11px;
  z-index: 1000;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  max-width: 300px;
  max-height: 80vh;
  overflow-y: auto;
}

.monitor-toggle {
  background: none;
  border: none;
  color: white;
  font-size: 16px;
  padding: 8px 12px;
  cursor: pointer;
  width: 100%;
  text-align: center;
}

.monitor-toggle:hover {
  background: rgba(255, 255, 255, 0.1);
}

.collapsed {
  width: auto;
}

.monitor-panel {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.monitor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  padding-bottom: 8px;
}

.monitor-title {
  font-size: 12px;
  font-weight: bold;
  margin: 0;
}

.monitor-controls {
  display: flex;
  gap: 4px;
}

.control-button {
  background: none;
  border: none;
  color: white;
  font-size: 12px;
  padding: 4px;
  cursor: pointer;
  border-radius: 3px;
}

.control-button:hover {
  background: rgba(255, 255, 255, 0.1);
}

.metrics-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-title {
  font-size: 10px;
  font-weight: bold;
  margin: 0;
  opacity: 0.8;
  text-transform: uppercase;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.metric-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.05);
}

.metric-label {
  font-size: 9px;
  opacity: 0.7;
}

.metric-value {
  font-size: 11px;
  font-weight: bold;
}

.good { color: #4ade80; }
.needs-improvement { color: #fbbf24; }
.poor { color: #ef4444; }
.unknown { color: #9ca3af; }

.metrics-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.metric-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2px 0;
}

.metric-name {
  font-size: 10px;
  opacity: 0.8;
}

.component-metrics {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 120px;
  overflow-y: auto;
}

.component-metric {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2px 0;
}

.component-name {
  font-size: 9px;
  opacity: 0.7;
}

.component-time {
  font-size: 10px;
  font-weight: bold;
}

.chart-container {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  padding: 8px;
}

.performance-chart {
  width: 100%;
  height: 60px;
  display: block;
}

.recommendations-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.recommendation-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px;
  border-radius: 3px;
  font-size: 10px;
}

.recommendation-item.high {
  background: rgba(239, 68, 68, 0.1);
  border-left: 2px solid #ef4444;
}

.recommendation-item.medium {
  background: rgba(251, 191, 36, 0.1);
  border-left: 2px solid #fbbf24;
}

.recommendation-item.low {
  background: rgba(156, 163, 175, 0.1);
  border-left: 2px solid #9ca3af;
}

.recommendation-icon {
  flex-shrink: 0;
}

.recommendation-text {
  line-height: 1.3;
}

/* Scrollbar styling */
.performance-monitor::-webkit-scrollbar {
  width: 4px;
}

.performance-monitor::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
}

.performance-monitor::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.3);
  border-radius: 2px;
}

.performance-monitor::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.5);
}
</style>