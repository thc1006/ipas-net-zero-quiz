import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useVisitorTracking } from '../../src/composables/useVisitorTracking.js'

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn()
}

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
})

describe('useVisitorTracking', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks()
    localStorageMock.getItem.mockReturnValue(null)
  })

  it('should initialize visitor tracking for new visitor', () => {
    const { totalVisits, uniqueVisitors, todayVisits, userVisits, visitorId } = useVisitorTracking()
    
    // Should start with initial values
    expect(totalVisits.value).toBe(0)
    expect(uniqueVisitors.value).toBe(0) 
    expect(todayVisits.value).toBe(0)
    expect(userVisits.value).toBe(0)
    expect(visitorId.value).toBeNull()
  })

  it('should generate unique visitor ID for new visitor', () => {
    localStorageMock.getItem.mockReturnValue(null)
    
    const { visitorId } = useVisitorTracking()
    
    // Should have called localStorage to get visitor ID
    expect(localStorageMock.getItem).toHaveBeenCalledWith('ipas-quiz-visitor-id')
  })

  it('should load existing visitor data', () => {
    // Mock existing data
    localStorageMock.getItem.mockImplementation((key) => {
      switch (key) {
        case 'ipas-quiz-total-visits': return '25'
        case 'ipas-quiz-unique-visitors': return '8'
        case 'ipas-quiz-today-visits': return '3'
        case 'ipas-quiz-user-visits': return '5'
        case 'ipas-quiz-visitor-id': return 'visitor_123_abc'
        case 'ipas-quiz-daily-reset': return new Date().toDateString()
        default: return null
      }
    })

    const { totalVisits, uniqueVisitors, todayVisits, userVisits, visitorId } = useVisitorTracking()
    
    // Should load existing values
    expect(totalVisits.value).toBe(25)
    expect(uniqueVisitors.value).toBe(8)
    expect(todayVisits.value).toBe(3)
    expect(userVisits.value).toBe(5)
    expect(visitorId.value).toBe('visitor_123_abc')
  })

  it('should compute return visitor status correctly', () => {
    localStorageMock.getItem.mockImplementation((key) => {
      switch (key) {
        case 'ipas-quiz-user-visits': return '3'
        case 'ipas-quiz-visitor-id': return 'visitor_123_abc'
        case 'ipas-quiz-daily-reset': return new Date().toDateString()
        default: return null
      }
    })

    const { isReturnVisitor } = useVisitorTracking()
    
    // Should identify as return visitor
    expect(isReturnVisitor.value).toBe(true)
  })

  it('should reset daily visits for new day', () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    
    localStorageMock.getItem.mockImplementation((key) => {
      switch (key) {
        case 'ipas-quiz-today-visits': return '10'
        case 'ipas-quiz-daily-reset': return yesterday.toDateString()
        case 'ipas-quiz-visitor-id': return 'visitor_123_abc'
        default: return null
      }
    })

    const { todayVisits } = useVisitorTracking()
    
    // Should reset today's visits
    expect(todayVisits.value).toBe(0)
  })
})