/**
 * Monitoring and Error Tracking Utilities
 * Handles performance monitoring, error tracking, and analytics
 */

class MonitoringService {
  constructor() {
    this.isProduction = import.meta.env.PROD
    this.enableAnalytics = import.meta.env.VITE_ENABLE_ANALYTICS === 'true'
    this.sentryDsn = import.meta.env.VITE_SENTRY_DSN
    this.gaTrackingId = import.meta.env.VITE_GA_TRACKING_ID
    
    this.initErrorTracking()
    this.initPerformanceMonitoring()
    this.initAnalytics()
  }

  /**
   * Initialize error tracking (Sentry integration)
   */
  async initErrorTracking() {
    if (!this.isProduction || !this.sentryDsn) {
      console.log('📊 Error tracking disabled (development mode or no DSN)')
      return
    }

    try {
      // Dynamic import for Sentry to reduce bundle size
      const [{ init, captureException }, { BrowserTracing }] = await Promise.all([
        import('@sentry/vue'),
        import('@sentry/tracing')
      ])

      init({
        dsn: this.sentryDsn,
        environment: this.isProduction ? 'production' : 'development',
        integrations: [
          new BrowserTracing({
            // Performance monitoring for Vue Router
            routingInstrumentation: (Vue) => {
              // Custom routing instrumentation for Vue 3
            }
          }),
        ],
        // Performance monitoring
        tracesSampleRate: this.isProduction ? 0.1 : 1.0,
        // Release information
        release: `ipas-quiz@${import.meta.env.VITE_APP_VERSION || '1.0.0'}`,
        // Filter out known non-critical errors
        beforeSend(event) {
          // Filter out network errors that are not actionable
          if (event.exception) {
            const error = event.exception.values[0]
            if (error.type === 'NetworkError' || error.type === 'ChunkLoadError') {
              return null
            }
          }
          return event
        },
        // User context
        initialScope: {
          tags: {
            component: 'quiz-app',
            language: 'zh-TW'
          },
        },
      })

      console.log('📊 Error tracking initialized')
    } catch (error) {
      console.warn('Failed to initialize error tracking:', error)
    }
  }

  /**
   * Initialize performance monitoring
   */
  initPerformanceMonitoring() {
    if (!this.isProduction) {
      return
    }

    // Core Web Vitals monitoring
    this.monitorWebVitals()
    
    // Custom performance metrics
    this.monitorCustomMetrics()
    
    // Quiz-specific metrics
    this.monitorQuizMetrics()
  }

  /**
   * Monitor Core Web Vitals
   */
  async monitorWebVitals() {
    try {
      const { getCLS, getFID, getFCP, getLCP, getTTFB } = await import('web-vitals')

      getCLS(this.sendMetric.bind(this))
      getFID(this.sendMetric.bind(this))
      getFCP(this.sendMetric.bind(this))
      getLCP(this.sendMetric.bind(this))
      getTTFB(this.sendMetric.bind(this))

      console.log('📊 Core Web Vitals monitoring initialized')
    } catch (error) {
      console.warn('Failed to load web-vitals:', error)
    }
  }

  /**
   * Send metric to analytics
   */
  sendMetric(metric) {
    const { name, value, id } = metric

    // Send to Google Analytics 4 if available
    if (typeof gtag !== 'undefined') {
      gtag('event', name, {
        event_category: 'Web Vitals',
        value: Math.round(name === 'CLS' ? value * 1000 : value),
        event_label: id,
        non_interaction: true,
      })
    }

    // Send to custom analytics endpoint
    this.sendCustomMetric('web_vitals', {
      metric: name,
      value: value,
      id: id,
      url: window.location.pathname,
      timestamp: Date.now()
    })

    console.log(`📊 ${name}:`, value)
  }

  /**
   * Monitor custom performance metrics
   */
  monitorCustomMetrics() {
    // Monitor bundle loading performance
    window.addEventListener('load', () => {
      const navigation = performance.getEntriesByType('navigation')[0]
      
      this.sendCustomMetric('performance', {
        domContentLoaded: navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart,
        loadComplete: navigation.loadEventEnd - navigation.loadEventStart,
        totalLoadTime: navigation.loadEventEnd - navigation.fetchStart,
        timestamp: Date.now()
      })
    })

    // Monitor resource loading
    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if (entry.entryType === 'resource') {
          // Track slow resources
          if (entry.duration > 1000) {
            this.sendCustomMetric('slow_resource', {
              name: entry.name,
              duration: entry.duration,
              size: entry.transferSize,
              timestamp: Date.now()
            })
          }
        }
      })
    })

    observer.observe({ entryTypes: ['resource'] })
  }

  /**
   * Monitor quiz-specific metrics
   */
  monitorQuizMetrics() {
    // Track quiz completion rates
    this.quizStartTime = null
    this.questionsAnswered = 0
    this.totalQuestions = 0
  }

  /**
   * Initialize analytics (Google Analytics)
   */
  async initAnalytics() {
    if (!this.enableAnalytics || !this.gaTrackingId) {
      console.log('📊 Analytics disabled')
      return
    }

    try {
      // Load Google Analytics 4
      const script = document.createElement('script')
      script.async = true
      script.src = `https://www.googletagmanager.com/gtag/js?id=${this.gaTrackingId}`
      document.head.appendChild(script)

      window.dataLayer = window.dataLayer || []
      window.gtag = function() { dataLayer.push(arguments) }
      window.gtag('js', new Date())
      window.gtag('config', this.gaTrackingId, {
        // Enhanced measurement
        enhanced_measurements: true,
        // Privacy settings for GDPR compliance
        anonymize_ip: true,
        // Custom dimensions for quiz tracking
        custom_map: {
          custom_dimension_1: 'quiz_language',
          custom_dimension_2: 'quiz_difficulty',
        }
      })

      console.log('📊 Google Analytics initialized')
    } catch (error) {
      console.warn('Failed to initialize analytics:', error)
    }
  }

  /**
   * Send custom metric to analytics endpoint
   */
  async sendCustomMetric(category, data) {
    if (!this.isProduction) {
      console.log(`📊 [${category}]`, data)
      return
    }

    try {
      // Send to custom analytics endpoint
      await fetch('/api/analytics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          category,
          data,
          userAgent: navigator.userAgent,
          url: window.location.href,
          timestamp: Date.now()
        })
      })
    } catch (error) {
      // Fail silently for analytics
      console.debug('Analytics error:', error)
    }
  }

  /**
   * Track quiz events
   */
  trackQuizEvent(action, data = {}) {
    // Google Analytics event
    if (typeof gtag !== 'undefined') {
      gtag('event', action, {
        event_category: 'quiz',
        ...data
      })
    }

    // Custom analytics
    this.sendCustomMetric('quiz_event', {
      action,
      ...data,
      timestamp: Date.now()
    })
  }

  /**
   * Track quiz start
   */
  trackQuizStart(totalQuestions) {
    this.quizStartTime = Date.now()
    this.totalQuestions = totalQuestions
    this.questionsAnswered = 0

    this.trackQuizEvent('quiz_start', {
      total_questions: totalQuestions
    })
  }

  /**
   * Track question answer
   */
  trackQuestionAnswer(questionId, isCorrect, timeSpent) {
    this.questionsAnswered++

    this.trackQuizEvent('question_answer', {
      question_id: questionId,
      is_correct: isCorrect,
      time_spent: timeSpent,
      progress: Math.round((this.questionsAnswered / this.totalQuestions) * 100)
    })
  }

  /**
   * Track quiz completion
   */
  trackQuizComplete(score, timeSpent) {
    const totalTime = Date.now() - this.quizStartTime

    this.trackQuizEvent('quiz_complete', {
      score: score,
      time_spent: totalTime,
      questions_answered: this.questionsAnswered,
      completion_rate: Math.round((this.questionsAnswered / this.totalQuestions) * 100)
    })
  }

  /**
   * Track errors
   */
  trackError(error, context = {}) {
    // Send to Sentry if available
    if (typeof Sentry !== 'undefined') {
      Sentry.captureException(error, {
        extra: context
      })
    }

    // Custom error tracking
    this.sendCustomMetric('error', {
      message: error.message,
      stack: error.stack,
      context,
      timestamp: Date.now()
    })

    console.error('Tracked error:', error, context)
  }

  /**
   * Track page view
   */
  trackPageView(path, title) {
    if (typeof gtag !== 'undefined') {
      gtag('config', this.gaTrackingId, {
        page_path: path,
        page_title: title,
      })
    }

    this.sendCustomMetric('page_view', {
      path,
      title,
      timestamp: Date.now()
    })
  }
}

// Create singleton instance
const monitoring = new MonitoringService()

export default monitoring

// Vue plugin for easy integration
export function createMonitoringPlugin() {
  return {
    install(app) {
      // Add to global properties
      app.config.globalProperties.$monitoring = monitoring
      
      // Provide for Composition API
      app.provide('monitoring', monitoring)
      
      // Track uncaught errors
      app.config.errorHandler = (err, vm, info) => {
        monitoring.trackError(err, {
          info,
          component: vm?.$options.name || 'unknown'
        })
      }
    }
  }
}