/**
 * Optimized Question Data Loader
 * Implements lazy loading, chunking, and streaming for large question datasets
 */

import { ref, computed } from 'vue'
import { trackAsyncOperation, performanceMonitor } from '@utils/performance.js'

/**
 * Question data manager with performance optimizations
 */
class QuestionDataManager {
  constructor() {
    this.cache = new Map()
    this.loadingPromises = new Map()
    this.chunkSize = 50 // Questions per chunk
    this.maxCacheSize = 200 // Maximum questions to keep in memory
    this.preloadThreshold = 10 // Preload when this many questions left
    this.subjects = new Map()
    this.isInitialized = false
  }

  /**
   * Initialize with question index/metadata
   */
  async initialize() {
    if (this.isInitialized) return

    const tracker = trackAsyncOperation('questionLoader.initialize')
    
    try {
      // Load question index (just metadata, not full questions)
      const index = await this.loadQuestionIndex()
      this.buildSubjectMap(index)
      this.isInitialized = true
      
      tracker.end({ questionsCount: index.length })
      performanceMonitor.recordMetric('questions.initialized', index.length)
      
    } catch (error) {
      tracker.end({ error: error.message })
      throw new Error(`Failed to initialize question loader: ${error.message}`)
    }
  }

  /**
   * Load question index with metadata only
   */
  async loadQuestionIndex() {
    const tracker = trackAsyncOperation('questionLoader.loadIndex')
    
    try {
      // Try to load from IndexedDB first
      const cachedIndex = await this.loadFromIndexedDB('question-index')
      if (cachedIndex) {
        tracker.end({ source: 'cache' })
        return cachedIndex
      }

      // Load from network and extract metadata
      const response = await fetch('/questions.json')
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      // Parse JSON in chunks to avoid blocking main thread
      const text = await response.text()
      const questions = await this.parseJSONInChunks(text)
      
      // Extract just the metadata for the index
      const index = questions.map(q => ({
        id: q.id,
        subject: q.subject,
        chunkId: this.getChunkId(q.id)
      }))

      // Cache the index
      await this.saveToIndexedDB('question-index', index)
      
      // Cache question chunks in background
      this.cacheQuestionChunks(questions)
      
      tracker.end({ source: 'network', questionsCount: questions.length })
      return index

    } catch (error) {
      tracker.end({ error: error.message })
      throw error
    }
  }

  /**
   * Parse large JSON in chunks to avoid blocking main thread
   */
  async parseJSONInChunks(text) {
    const tracker = trackAsyncOperation('questionLoader.parseJSON')
    
    return new Promise((resolve, reject) => {
      // Use a Worker for large JSON parsing if available
      if (window.Worker) {
        const worker = new Worker(new URL('../workers/json-parser.js', import.meta.url))
        
        worker.postMessage({ text })
        
        worker.onmessage = (e) => {
          if (e.data.error) {
            tracker.end({ error: e.data.error })
            reject(new Error(e.data.error))
          } else {
            tracker.end({ size: text.length })
            resolve(e.data.questions)
          }
          worker.terminate()
        }
      } else {
        // Fallback: parse in main thread with yield
        setTimeout(() => {
          try {
            const questions = JSON.parse(text)
            tracker.end({ size: text.length, fallback: true })
            resolve(questions)
          } catch (error) {
            tracker.end({ error: error.message, fallback: true })
            reject(error)
          }
        }, 0)
      }
    })
  }

  /**
   * Build subject mapping for efficient filtering
   */
  buildSubjectMap(index) {
    const subjectMap = new Map()
    
    index.forEach(question => {
      if (!subjectMap.has(question.subject)) {
        subjectMap.set(question.subject, [])
      }
      subjectMap.get(question.subject).push(question)
    })
    
    this.subjects = subjectMap
  }

  /**
   * Cache question chunks in background
   */
  async cacheQuestionChunks(questions) {
    const chunks = this.splitIntoChunks(questions)
    
    // Cache chunks with priority (common subjects first)
    const priorities = this.getSubjectPriorities()
    
    for (const [chunkId, chunk] of chunks) {
      const priority = this.getChunkPriority(chunk, priorities)
      
      // Use requestIdleCallback for non-critical caching
      if (window.requestIdleCallback) {
        window.requestIdleCallback(() => {
          this.saveToIndexedDB(`chunk-${chunkId}`, chunk)
        }, { timeout: priority < 2 ? 1000 : 5000 })
      } else {
        // Fallback for browsers without requestIdleCallback
        setTimeout(() => {
          this.saveToIndexedDB(`chunk-${chunkId}`, chunk)
        }, priority * 100)
      }
    }
  }

  /**
   * Split questions into optimized chunks
   */
  splitIntoChunks(questions) {
    const chunks = new Map()
    
    questions.forEach(question => {
      const chunkId = this.getChunkId(question.id)
      
      if (!chunks.has(chunkId)) {
        chunks.set(chunkId, [])
      }
      
      chunks.get(chunkId).push(question)
    })
    
    return chunks
  }

  /**
   * Get chunk ID for a question
   */
  getChunkId(questionId) {
    // Extract subject prefix and create chunk ID
    const match = questionId.match(/^([^-]+)-(\d+)/)
    if (match) {
      const [, subject, num] = match
      const chunkNum = Math.floor(parseInt(num) / this.chunkSize)
      return `${subject}-${chunkNum}`
    }
    return 'default-0'
  }

  /**
   * Get subject priorities for caching order
   */
  getSubjectPriorities() {
    // Priority based on subject frequency or user preference
    return {
      'c1': 1, // Core subjects first
      'c2': 1,
      'c3': 2,
      'c4': 2,
      'default': 3
    }
  }

  /**
   * Get chunk caching priority
   */
  getChunkPriority(chunk, priorities) {
    if (chunk.length === 0) return 10
    
    const subject = chunk[0].subject || ''
    const subjectKey = subject.split('：')[0] || 'default'
    
    return priorities[subjectKey] || priorities.default
  }

  /**
   * Load questions by subject with lazy loading
   */
  async loadQuestionsBySubject(subjectFilter = null, limit = null) {
    const tracker = trackAsyncOperation('questionLoader.loadBySubject')
    
    try {
      if (!this.isInitialized) {
        await this.initialize()
      }

      let targetQuestions = []
      
      if (subjectFilter) {
        targetQuestions = this.subjects.get(subjectFilter) || []
      } else {
        // Get all questions from all subjects
        for (const questions of this.subjects.values()) {
          targetQuestions.push(...questions)
        }
      }

      // Apply limit if specified
      if (limit && limit > 0) {
        targetQuestions = targetQuestions.slice(0, limit)
      }

      // Load actual question data in chunks
      const loadedQuestions = await this.loadQuestionData(targetQuestions)
      
      tracker.end({ 
        subject: subjectFilter || 'all', 
        count: loadedQuestions.length,
        limit 
      })
      
      return loadedQuestions

    } catch (error) {
      tracker.end({ error: error.message })
      throw error
    }
  }

  /**
   * Load actual question data for given question metadata
   */
  async loadQuestionData(questionIndex) {
    const chunkMap = new Map()
    
    // Group questions by chunk
    questionIndex.forEach(q => {
      const chunkId = q.chunkId
      if (!chunkMap.has(chunkId)) {
        chunkMap.set(chunkId, [])
      }
      chunkMap.get(chunkId).push(q.id)
    })

    // Load chunks concurrently
    const chunkPromises = Array.from(chunkMap.keys()).map(async (chunkId) => {
      return this.loadChunk(chunkId)
    })

    const chunks = await Promise.all(chunkPromises)
    
    // Flatten and filter questions
    const allQuestions = chunks.flat()
    const questionMap = new Map(allQuestions.map(q => [q.id, q]))
    
    // Return questions in the requested order
    return questionIndex
      .map(q => questionMap.get(q.id))
      .filter(Boolean)
  }

  /**
   * Load a specific chunk with caching
   */
  async loadChunk(chunkId) {
    // Check if already loading
    if (this.loadingPromises.has(chunkId)) {
      return this.loadingPromises.get(chunkId)
    }

    // Check memory cache
    if (this.cache.has(chunkId)) {
      performanceMonitor.recordMetric('questions.cacheHit', 1)
      return this.cache.get(chunkId)
    }

    const tracker = trackAsyncOperation('questionLoader.loadChunk')
    
    // Create loading promise
    const loadPromise = this.loadChunkData(chunkId).then(chunk => {
      // Cache in memory with size limit
      this.addToCache(chunkId, chunk)
      
      tracker.end({ chunkId, size: chunk.length })
      performanceMonitor.recordMetric('questions.chunkLoaded', chunk.length)
      
      return chunk
    }).catch(error => {
      tracker.end({ chunkId, error: error.message })
      throw error
    }).finally(() => {
      this.loadingPromises.delete(chunkId)
    })

    this.loadingPromises.set(chunkId, loadPromise)
    return loadPromise
  }

  /**
   * Load chunk data from storage or network
   */
  async loadChunkData(chunkId) {
    // Try IndexedDB first
    const cachedChunk = await this.loadFromIndexedDB(`chunk-${chunkId}`)
    if (cachedChunk) {
      return cachedChunk
    }

    // Fallback: load from main questions file
    // This should rarely happen if caching works properly
    console.warn(`Chunk ${chunkId} not found in cache, loading from main file`)
    
    const response = await fetch('/questions.json')
    const questions = await response.json()
    
    // Extract the chunk and cache it
    const chunk = questions.filter(q => this.getChunkId(q.id) === chunkId)
    await this.saveToIndexedDB(`chunk-${chunkId}`, chunk)
    
    return chunk
  }

  /**
   * Add to memory cache with LRU eviction
   */
  addToCache(key, data) {
    // Remove oldest items if cache is full
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
    
    this.cache.set(key, data)
  }

  /**
   * Preload next chunks based on current question
   */
  async preloadNext(currentQuestionId) {
    const currentChunkId = this.getChunkId(currentQuestionId)
    const currentChunk = this.cache.get(currentChunkId)
    
    if (!currentChunk) return
    
    // Check if we're near the end of the current chunk
    const currentIndex = currentChunk.findIndex(q => q.id === currentQuestionId)
    const remainingInChunk = currentChunk.length - currentIndex - 1
    
    if (remainingInChunk <= this.preloadThreshold) {
      // Preload next chunk
      const nextChunkId = this.getNextChunkId(currentChunkId)
      if (nextChunkId && !this.cache.has(nextChunkId)) {
        // Preload in background
        this.loadChunk(nextChunkId).catch(error => {
          console.warn('Preload failed for chunk', nextChunkId, error)
        })
      }
    }
  }

  /**
   * Get next chunk ID
   */
  getNextChunkId(currentChunkId) {
    const match = currentChunkId.match(/^(.+)-(\d+)$/)
    if (match) {
      const [, prefix, num] = match
      return `${prefix}-${parseInt(num) + 1}`
    }
    return null
  }

  /**
   * IndexedDB operations
   */
  async saveToIndexedDB(key, data) {
    if (!window.indexedDB) return
    
    try {
      const db = await this.getDatabase()
      const transaction = db.transaction(['questions'], 'readwrite')
      const store = transaction.objectStore('questions')
      
      await store.put({ key, data, timestamp: Date.now() })
      
    } catch (error) {
      console.warn('IndexedDB save failed:', error)
    }
  }

  async loadFromIndexedDB(key) {
    if (!window.indexedDB) return null
    
    try {
      const db = await this.getDatabase()
      const transaction = db.transaction(['questions'], 'readonly')
      const store = transaction.objectStore('questions')
      const result = await store.get(key)
      
      if (result && result.data) {
        // Check if data is still fresh (24 hours)
        const isExpired = Date.now() - result.timestamp > 24 * 60 * 60 * 1000
        if (!isExpired) {
          return result.data
        } else {
          // Clean up expired data
          this.deleteFromIndexedDB(key)
        }
      }
      
    } catch (error) {
      console.warn('IndexedDB load failed:', error)
    }
    
    return null
  }

  async deleteFromIndexedDB(key) {
    if (!window.indexedDB) return
    
    try {
      const db = await this.getDatabase()
      const transaction = db.transaction(['questions'], 'readwrite')
      const store = transaction.objectStore('questions')
      
      await store.delete(key)
      
    } catch (error) {
      console.warn('IndexedDB delete failed:', error)
    }
  }

  async getDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('iPAS-Quiz-Cache', 1)
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result
        if (!db.objectStoreNames.contains('questions')) {
          db.createObjectStore('questions', { keyPath: 'key' })
        }
      }
    })
  }

  /**
   * Clear all cached data
   */
  async clearCache() {
    this.cache.clear()
    this.loadingPromises.clear()
    
    if (window.indexedDB) {
      try {
        const db = await this.getDatabase()
        const transaction = db.transaction(['questions'], 'readwrite')
        const store = transaction.objectStore('questions')
        await store.clear()
      } catch (error) {
        console.warn('Failed to clear IndexedDB cache:', error)
      }
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      memoryCacheSize: this.cache.size,
      loadingPromises: this.loadingPromises.size,
      isInitialized: this.isInitialized,
      subjects: Array.from(this.subjects.keys())
    }
  }
}

// Global instance
const questionManager = new QuestionDataManager()

/**
 * Vue composable for question loading
 */
export function useQuestionLoader() {
  const isLoading = ref(false)
  const error = ref(null)
  const questions = ref([])
  const subjects = computed(() => Array.from(questionManager.subjects.keys()))

  const loadQuestions = async (subjectFilter = null, limit = null) => {
    isLoading.value = true
    error.value = null
    
    try {
      const loadedQuestions = await questionManager.loadQuestionsBySubject(subjectFilter, limit)
      questions.value = loadedQuestions
      return loadedQuestions
    } catch (err) {
      error.value = err.message
      console.error('Failed to load questions:', err)
      return []
    } finally {
      isLoading.value = false
    }
  }

  const preloadNext = (currentQuestionId) => {
    questionManager.preloadNext(currentQuestionId)
  }

  const clearCache = () => {
    return questionManager.clearCache()
  }

  const getCacheStats = () => {
    return questionManager.getCacheStats()
  }

  return {
    isLoading,
    error,
    questions,
    subjects,
    loadQuestions,
    preloadNext,
    clearCache,
    getCacheStats
  }
}

export { questionManager }
export default useQuestionLoader