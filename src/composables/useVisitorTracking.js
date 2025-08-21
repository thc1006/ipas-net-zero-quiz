import { ref, computed, onMounted } from 'vue'

/**
 * Visitor tracking composable for iPAS quiz application
 * Tracks visitor statistics using localStorage without backend
 */
export function useVisitorTracking() {
  // Reactive data
  const totalVisits = ref(0)
  const uniqueVisitors = ref(0)
  const todayVisits = ref(0)
  const userVisits = ref(0)
  const firstVisitDate = ref(null)
  const lastVisitDate = ref(null)
  const visitorId = ref(null)

  // Storage keys
  const STORAGE_KEYS = {
    TOTAL_VISITS: 'ipas-quiz-total-visits',
    UNIQUE_VISITORS: 'ipas-quiz-unique-visitors',
    TODAY_VISITS: 'ipas-quiz-today-visits',
    USER_VISITS: 'ipas-quiz-user-visits',
    FIRST_VISIT: 'ipas-quiz-first-visit',
    LAST_VISIT: 'ipas-quiz-last-visit',
    VISITOR_ID: 'ipas-quiz-visitor-id',
    DAILY_RESET: 'ipas-quiz-daily-reset'
  }

  /**
   * Generate a unique visitor ID
   */
  function generateVisitorId() {
    return 'visitor_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
  }

  /**
   * Get today's date string for comparison
   */
  function getTodayString() {
    return new Date().toDateString()
  }

  /**
   * Check if today's visits need to be reset
   */
  function checkDailyReset() {
    const lastReset = localStorage.getItem(STORAGE_KEYS.DAILY_RESET)
    const today = getTodayString()
    
    if (lastReset !== today) {
      // Reset today's visits
      todayVisits.value = 0
      localStorage.setItem(STORAGE_KEYS.TODAY_VISITS, '0')
      localStorage.setItem(STORAGE_KEYS.DAILY_RESET, today)
      return true
    }
    return false
  }

  /**
   * Initialize visitor tracking data
   */
  function initializeVisitorData() {
    const now = new Date()
    const today = getTodayString()

    // Check for existing visitor ID
    let existingVisitorId = localStorage.getItem(STORAGE_KEYS.VISITOR_ID)
    if (!existingVisitorId) {
      existingVisitorId = generateVisitorId()
      localStorage.setItem(STORAGE_KEYS.VISITOR_ID, existingVisitorId)
      
      // New unique visitor
      uniqueVisitors.value = parseInt(localStorage.getItem(STORAGE_KEYS.UNIQUE_VISITORS) || '0') + 1
      localStorage.setItem(STORAGE_KEYS.UNIQUE_VISITORS, uniqueVisitors.value.toString())
      
      // Set first visit date
      firstVisitDate.value = now.toISOString()
      localStorage.setItem(STORAGE_KEYS.FIRST_VISIT, firstVisitDate.value)
    } else {
      // Existing visitor
      uniqueVisitors.value = parseInt(localStorage.getItem(STORAGE_KEYS.UNIQUE_VISITORS) || '1')
      firstVisitDate.value = localStorage.getItem(STORAGE_KEYS.FIRST_VISIT)
    }

    visitorId.value = existingVisitorId

    // Load existing data
    totalVisits.value = parseInt(localStorage.getItem(STORAGE_KEYS.TOTAL_VISITS) || '0')
    userVisits.value = parseInt(localStorage.getItem(STORAGE_KEYS.USER_VISITS) || '0')
    
    // Check if daily reset is needed
    checkDailyReset()
    
    // Load today's visits after potential reset
    todayVisits.value = parseInt(localStorage.getItem(STORAGE_KEYS.TODAY_VISITS) || '0')
  }

  /**
   * Record a new visit
   */
  function recordVisit() {
    const now = new Date()

    // Increment counters
    totalVisits.value += 1
    todayVisits.value += 1
    userVisits.value += 1

    // Update last visit date
    lastVisitDate.value = now.toISOString()

    // Save to localStorage
    localStorage.setItem(STORAGE_KEYS.TOTAL_VISITS, totalVisits.value.toString())
    localStorage.setItem(STORAGE_KEYS.TODAY_VISITS, todayVisits.value.toString())
    localStorage.setItem(STORAGE_KEYS.USER_VISITS, userVisits.value.toString())
    localStorage.setItem(STORAGE_KEYS.LAST_VISIT, lastVisitDate.value)
  }

  /**
   * Get visitor statistics summary
   */
  const visitorStats = computed(() => {
    return {
      totalVisits: totalVisits.value,
      uniqueVisitors: uniqueVisitors.value,
      todayVisits: todayVisits.value,
      userVisits: userVisits.value,
      firstVisitDate: firstVisitDate.value,
      lastVisitDate: lastVisitDate.value,
      visitorId: visitorId.value
    }
  })

  /**
   * Format date for display
   */
  function formatDate(dateString) {
    if (!dateString) return ''
    const date = new Date(dateString)
    return date.toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  /**
   * Get days since first visit
   */
  const daysSinceFirstVisit = computed(() => {
    if (!firstVisitDate.value) return 0
    const first = new Date(firstVisitDate.value)
    const now = new Date()
    const diffTime = Math.abs(now - first)
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  })

  /**
   * Check if user is a return visitor
   */
  const isReturnVisitor = computed(() => {
    return userVisits.value > 1
  })

  /**
   * Initialize tracking on mount
   */
  onMounted(() => {
    initializeVisitorData()
    recordVisit()
  })

  return {
    // Reactive data
    totalVisits,
    uniqueVisitors,
    todayVisits,
    userVisits,
    firstVisitDate,
    lastVisitDate,
    visitorId,
    
    // Computed properties
    visitorStats,
    daysSinceFirstVisit,
    isReturnVisitor,
    
    // Methods
    recordVisit,
    formatDate,
    initializeVisitorData
  }
}