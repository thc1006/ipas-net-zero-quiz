/**
 * Performance Monitoring and Optimization Utilities
 * Provides comprehensive performance tracking and optimization for Vue 3 applications
 */

/**
 * Performance metrics storage
 */
class PerformanceMonitor {
  constructor() {
    this.metrics = new Map()
    this.observers = new Set()
    this.isSupported = typeof window !== 'undefined' && 'performance' in window
    
    if (this.isSupported) {
      this.initializeObservers()
    }
  }

  /**
   * Initialize performance observers
   */
  initializeObservers() {
    try {
      // Observe paint metrics
      if ('PerformanceObserver' in window) {
        const paintObserver = new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            this.recordMetric(`paint.${entry.name}`, entry.startTime)
          }
        })
        paintObserver.observe({ entryTypes: ['paint'] })
        this.observers.add(paintObserver)

        // Observe largest contentful paint
        const lcpObserver = new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries()
          const lastEntry = entries[entries.length - 1]
          this.recordMetric('lcp', lastEntry.startTime)
        })
        lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] })
        this.observers.add(lcpObserver)

        // Observe cumulative layout shift
        const clsObserver = new PerformanceObserver((entryList) => {
          let cls = 0
          for (const entry of entryList.getEntries()) {
            if (!entry.hadRecentInput) {
              cls += entry.value
            }
          }
          this.recordMetric('cls', cls)
        })
        clsObserver.observe({ entryTypes: ['layout-shift'] })
        this.observers.add(clsObserver)

        // Observe first input delay
        const fidObserver = new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            this.recordMetric('fid', entry.processingStart - entry.startTime)
          }
        })
        fidObserver.observe({ entryTypes: ['first-input'] })
        this.observers.add(fidObserver)
      }
    } catch (error) {
      console.warn('Performance observers not supported:', error)
    }
  }

  /**
   * Record a performance metric
   */
  recordMetric(name, value, metadata = {}) {
    const timestamp = Date.now()
    
    if (!this.metrics.has(name)) {
      this.metrics.set(name, [])
    }
    
    this.metrics.get(name).push({
      value,
      timestamp,
      metadata
    })

    // Emit metric event for external listeners
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('performance-metric', {
        detail: { name, value, timestamp, metadata }
      }))
    }
  }

  /**
   * Get metrics by name
   */
  getMetric(name) {
    return this.metrics.get(name) || []
  }

  /**
   * Get all metrics
   */
  getAllMetrics() {
    const result = {}
    for (const [name, values] of this.metrics.entries()) {
      result[name] = values
    }
    return result
  }

  /**
   * Clear metrics
   */
  clearMetrics() {
    this.metrics.clear()
  }

  /**
   * Get performance summary
   */
  getSummary() {
    const summary = {}
    
    for (const [name, values] of this.metrics.entries()) {
      if (values.length > 0) {
        const nums = values.map(v => v.value).filter(v => typeof v === 'number')
        if (nums.length > 0) {
          summary[name] = {
            count: nums.length,
            min: Math.min(...nums),
            max: Math.max(...nums),
            avg: nums.reduce((a, b) => a + b, 0) / nums.length,
            latest: values[values.length - 1].value
          }
        }
      }
    }
    
    return summary
  }

  /**
   * Cleanup observers
   */
  cleanup() {
    for (const observer of this.observers) {
      observer.disconnect()
    }
    this.observers.clear()
  }
}

// Global performance monitor instance
const performanceMonitor = new PerformanceMonitor()

/**
 * Memory management utilities
 */
export class MemoryManager {
  constructor() {
    this.cleanupTasks = new Set()
    this.intervalCleanup = null
    this.isEnabled = typeof window !== 'undefined'
    
    if (this.isEnabled) {
      this.startPeriodicCleanup()
    }
  }

  /**
   * Register a cleanup task
   */
  registerCleanup(task, interval = 30000) {
    if (typeof task === 'function') {
      this.cleanupTasks.add(task)
    }
  }

  /**
   * Unregister a cleanup task
   */
  unregisterCleanup(task) {
    this.cleanupTasks.delete(task)
  }

  /**
   * Force garbage collection (if available)
   */
  forceGC() {
    if (window.gc && typeof window.gc === 'function') {
      try {
        window.gc()
        performanceMonitor.recordMetric('gc.forced', Date.now())
      } catch (error) {
        console.warn('Manual GC failed:', error)
      }
    }
  }

  /**
   * Get memory usage (if available)
   */
  getMemoryUsage() {
    if (performance.memory) {
      return {
        used: performance.memory.usedJSHeapSize,
        total: performance.memory.totalJSHeapSize,
        limit: performance.memory.jsHeapSizeLimit,
        percentage: (performance.memory.usedJSHeapSize / performance.memory.totalJSHeapSize) * 100
      }
    }
    return null
  }

  /**
   * Monitor memory usage
   */
  monitorMemory() {
    const usage = this.getMemoryUsage()
    if (usage) {
      performanceMonitor.recordMetric('memory.used', usage.used)
      performanceMonitor.recordMetric('memory.percentage', usage.percentage)
      
      // Warn if memory usage is high
      if (usage.percentage > 80) {
        console.warn('High memory usage detected:', usage)
        this.runCleanupTasks()
      }
    }
  }

  /**
   * Run all registered cleanup tasks
   */
  runCleanupTasks() {
    for (const task of this.cleanupTasks) {
      try {
        task()
      } catch (error) {
        console.error('Cleanup task failed:', error)
      }
    }
  }

  /**
   * Start periodic cleanup
   */
  startPeriodicCleanup(interval = 60000) {
    if (this.intervalCleanup) {
      clearInterval(this.intervalCleanup)
    }
    
    this.intervalCleanup = setInterval(() => {
      this.monitorMemory()
      this.runCleanupTasks()
    }, interval)
  }

  /**
   * Stop periodic cleanup
   */
  stopPeriodicCleanup() {
    if (this.intervalCleanup) {
      clearInterval(this.intervalCleanup)
      this.intervalCleanup = null
    }
  }

  /**
   * Cleanup manager itself
   */
  cleanup() {
    this.stopPeriodicCleanup()
    this.cleanupTasks.clear()
  }
}

/**
 * Bundle analyzer and optimizer
 */
export class BundleOptimizer {
  static analyzeChunks() {
    const chunks = []
    const scripts = document.querySelectorAll('script[src]')
    
    scripts.forEach(script => {
      const src = script.src
      if (src.includes('js/')) {
        chunks.push({
          url: src,
          element: script
        })
      }
    })
    
    return chunks
  }

  static preloadCriticalChunks(chunkNames = []) {
    chunkNames.forEach(chunkName => {
      const link = document.createElement('link')
      link.rel = 'modulepreload'
      link.href = `/js/${chunkName}.js`
      document.head.appendChild(link)
    })
  }

  static measureChunkLoadTime(chunkUrl) {
    const startTime = performance.now()
    
    return new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = chunkUrl
      script.type = 'module'
      
      script.onload = () => {
        const loadTime = performance.now() - startTime
        performanceMonitor.recordMetric('chunk.loadTime', loadTime, { url: chunkUrl })
        resolve(loadTime)
      }
      
      script.onerror = reject
      document.head.appendChild(script)
    })
  }
}

/**
 * Component performance tracker
 */
export function trackComponentPerformance(componentName, operation = 'render') {
  const startTime = performance.now()
  
  return {
    end: () => {
      const endTime = performance.now()
      const duration = endTime - startTime
      performanceMonitor.recordMetric(`component.${componentName}.${operation}`, duration)
      return duration
    }
  }
}

/**
 * Async operation performance tracker
 */
export function trackAsyncOperation(operationName) {
  const startTime = performance.now()
  
  return {
    end: (metadata = {}) => {
      const endTime = performance.now()
      const duration = endTime - startTime
      performanceMonitor.recordMetric(`async.${operationName}`, duration, metadata)
      return duration
    }
  }
}

/**
 * FPS monitor
 */
export class FPSMonitor {
  constructor() {
    this.fps = 0
    this.lastTime = 0
    this.frameCount = 0
    this.isRunning = false
    this.rafId = null
  }

  start() {
    if (this.isRunning) return
    
    this.isRunning = true
    this.lastTime = performance.now()
    this.frameCount = 0
    this.measure()
  }

  stop() {
    this.isRunning = false
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  measure() {
    if (!this.isRunning) return

    const currentTime = performance.now()
    this.frameCount++

    if (currentTime >= this.lastTime + 1000) {
      this.fps = Math.round((this.frameCount * 1000) / (currentTime - this.lastTime))
      performanceMonitor.recordMetric('fps', this.fps)
      
      this.frameCount = 0
      this.lastTime = currentTime
    }

    this.rafId = requestAnimationFrame(() => this.measure())
  }

  getFPS() {
    return this.fps
  }
}

/**
 * Debounce utility with performance tracking
 */
export function performanceDebounce(func, delay, name = 'debounced') {
  let timeoutId
  let lastCallTime = 0
  
  return function(...args) {
    const currentTime = performance.now()
    const timeSinceLastCall = currentTime - lastCallTime
    
    clearTimeout(timeoutId)
    
    timeoutId = setTimeout(() => {
      const tracker = trackAsyncOperation(`debounce.${name}`)
      func.apply(this, args)
      tracker.end({ delay, timeSinceLastCall })
    }, delay)
    
    lastCallTime = currentTime
  }
}

/**
 * Throttle utility with performance tracking
 */
export function performanceThrottle(func, delay, name = 'throttled') {
  let lastCallTime = 0
  let timeoutId
  
  return function(...args) {
    const currentTime = performance.now()
    const timeSinceLastCall = currentTime - lastCallTime
    
    if (timeSinceLastCall >= delay) {
      lastCallTime = currentTime
      const tracker = trackAsyncOperation(`throttle.${name}`)
      func.apply(this, args)
      tracker.end({ delay, timeSinceLastCall })
    } else {
      clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        lastCallTime = performance.now()
        const tracker = trackAsyncOperation(`throttle.${name}.delayed`)
        func.apply(this, args)
        tracker.end({ delay, timeSinceLastCall })
      }, delay - timeSinceLastCall)
    }
  }
}

// Global instances
export const memoryManager = new MemoryManager()
export const fpsMonitor = new FPSMonitor()

// Export performance monitor
export { performanceMonitor }

// Initialize performance monitoring
if (typeof window !== 'undefined') {
  // Start FPS monitoring in development
  if (import.meta.env.DEV) {
    fpsMonitor.start()
  }
  
  // Monitor performance on page load
  window.addEventListener('load', () => {
    performanceMonitor.recordMetric('page.loadComplete', performance.now())
  })
  
  // Monitor performance on page visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      performanceMonitor.recordMetric('page.hidden', performance.now())
      memoryManager.runCleanupTasks()
    } else {
      performanceMonitor.recordMetric('page.visible', performance.now())
    }
  })
  
  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    performanceMonitor.cleanup()
    memoryManager.cleanup()
    fpsMonitor.stop()
  })
}