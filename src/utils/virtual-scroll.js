/**
 * Virtual Scrolling Implementation for Large Data Sets
 * Efficiently renders only visible items in large lists to optimize performance
 */

import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { trackComponentPerformance, performanceThrottle } from './performance.js'

/**
 * Virtual scrolling composable for large lists
 */
export function useVirtualScroll(options = {}) {
  const {
    itemHeight = 50,
    containerHeight = 400,
    buffer = 5,
    items = ref([]),
    estimateItemHeight = null
  } = options

  // Reactive state
  const scrollTop = ref(0)
  const containerRef = ref(null)
  const isScrolling = ref(false)
  const scrollDirection = ref('down')
  const lastScrollTop = ref(0)

  // Computed properties
  const visibleItemsCount = computed(() => {
    return Math.ceil(containerHeight / itemHeight)
  })

  const totalHeight = computed(() => {
    return items.value.length * itemHeight
  })

  const startIndex = computed(() => {
    const index = Math.floor(scrollTop.value / itemHeight)
    return Math.max(0, index - buffer)
  })

  const endIndex = computed(() => {
    const index = startIndex.value + visibleItemsCount.value + (buffer * 2)
    return Math.min(items.value.length, index)
  })

  const visibleItems = computed(() => {
    const tracker = trackComponentPerformance('virtualScroll', 'computeVisible')
    const result = items.value.slice(startIndex.value, endIndex.value).map((item, index) => ({
      ...item,
      index: startIndex.value + index,
      offset: (startIndex.value + index) * itemHeight
    }))
    tracker.end()
    return result
  })

  const offsetY = computed(() => {
    return startIndex.value * itemHeight
  })

  // Methods
  const updateScrollPosition = performanceThrottle((event) => {
    const newScrollTop = event.target.scrollTop
    scrollDirection.value = newScrollTop > lastScrollTop.value ? 'down' : 'up'
    lastScrollTop.value = scrollTop.value
    scrollTop.value = newScrollTop
    
    if (!isScrolling.value) {
      isScrolling.value = true
      setTimeout(() => {
        isScrolling.value = false
      }, 150)
    }
  }, 16, 'virtualScroll') // 60fps throttling

  const scrollToIndex = (index) => {
    if (!containerRef.value) return
    
    const targetScrollTop = index * itemHeight
    containerRef.value.scrollTop = targetScrollTop
    scrollTop.value = targetScrollTop
  }

  const scrollToItem = (item) => {
    const index = items.value.findIndex(i => i.id === item.id)
    if (index !== -1) {
      scrollToIndex(index)
    }
  }

  // Lifecycle
  onMounted(() => {
    if (containerRef.value) {
      containerRef.value.addEventListener('scroll', updateScrollPosition, { passive: true })
    }
  })

  onUnmounted(() => {
    if (containerRef.value) {
      containerRef.value.removeEventListener('scroll', updateScrollPosition)
    }
  })

  return {
    // Template refs
    containerRef,
    
    // State
    scrollTop,
    isScrolling,
    scrollDirection,
    
    // Computed
    visibleItems,
    visibleItemsCount,
    totalHeight,
    offsetY,
    startIndex,
    endIndex,
    
    // Methods
    scrollToIndex,
    scrollToItem,
    updateScrollPosition
  }
}

/**
 * Advanced virtual grid for complex layouts
 */
export function useVirtualGrid(options = {}) {
  const {
    itemWidth = 200,
    itemHeight = 150,
    containerWidth = 800,
    containerHeight = 600,
    gap = 10,
    items = ref([]),
    buffer = 2
  } = options

  // Calculate columns
  const columnsCount = computed(() => {
    return Math.floor((containerWidth + gap) / (itemWidth + gap))
  })

  const rowsCount = computed(() => {
    return Math.ceil(items.value.length / columnsCount.value)
  })

  // Virtual scrolling state
  const scrollTop = ref(0)
  const containerRef = ref(null)

  // Calculate visible rows
  const visibleRowsCount = computed(() => {
    return Math.ceil(containerHeight / (itemHeight + gap))
  })

  const startRowIndex = computed(() => {
    const index = Math.floor(scrollTop.value / (itemHeight + gap))
    return Math.max(0, index - buffer)
  })

  const endRowIndex = computed(() => {
    const index = startRowIndex.value + visibleRowsCount.value + (buffer * 2)
    return Math.min(rowsCount.value, index)
  })

  // Calculate visible items
  const visibleItems = computed(() => {
    const startItem = startRowIndex.value * columnsCount.value
    const endItem = Math.min(
      endRowIndex.value * columnsCount.value,
      items.value.length
    )

    return items.value.slice(startItem, endItem).map((item, index) => {
      const actualIndex = startItem + index
      const row = Math.floor(actualIndex / columnsCount.value)
      const col = actualIndex % columnsCount.value

      return {
        ...item,
        index: actualIndex,
        x: col * (itemWidth + gap),
        y: row * (itemHeight + gap)
      }
    })
  })

  const totalHeight = computed(() => {
    return rowsCount.value * (itemHeight + gap) - gap
  })

  const offsetY = computed(() => {
    return startRowIndex.value * (itemHeight + gap)
  })

  // Scroll handler
  const updateScrollPosition = performanceThrottle((event) => {
    scrollTop.value = event.target.scrollTop
  }, 16, 'virtualGrid')

  // Lifecycle
  onMounted(() => {
    if (containerRef.value) {
      containerRef.value.addEventListener('scroll', updateScrollPosition, { passive: true })
    }
  })

  onUnmounted(() => {
    if (containerRef.value) {
      containerRef.value.removeEventListener('scroll', updateScrollPosition)
    }
  })

  return {
    containerRef,
    visibleItems,
    totalHeight,
    offsetY,
    columnsCount,
    rowsCount,
    scrollTop
  }
}

/**
 * Dynamic height virtual scrolling for variable item heights
 */
export function useDynamicVirtualScroll(options = {}) {
  const {
    estimateItemHeight = 100,
    containerHeight = 400,
    buffer = 3,
    items = ref([])
  } = options

  // Height cache for measured items
  const itemHeights = ref(new Map())
  const itemOffsets = ref(new Map())
  const containerRef = ref(null)
  const scrollTop = ref(0)
  const measuredItems = ref(new Set())

  // Calculate total height and offsets
  const calculateLayout = () => {
    let offset = 0
    const newOffsets = new Map()

    items.value.forEach((item, index) => {
      newOffsets.set(index, offset)
      const height = itemHeights.value.get(index) || estimateItemHeight
      offset += height
    })

    itemOffsets.value = newOffsets
    return offset
  }

  const totalHeight = computed(() => {
    return calculateLayout()
  })

  // Find items in viewport
  const getVisibleRange = () => {
    const scrollStart = scrollTop.value
    const scrollEnd = scrollStart + containerHeight

    let startIndex = 0
    let endIndex = items.value.length - 1

    // Binary search for start index
    let low = 0
    let high = items.value.length - 1
    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      const offset = itemOffsets.value.get(mid) || 0
      
      if (offset < scrollStart) {
        low = mid + 1
        startIndex = low
      } else {
        high = mid - 1
      }
    }

    // Find end index
    for (let i = startIndex; i < items.value.length; i++) {
      const offset = itemOffsets.value.get(i) || 0
      if (offset > scrollEnd) {
        endIndex = i
        break
      }
    }

    return {
      start: Math.max(0, startIndex - buffer),
      end: Math.min(items.value.length, endIndex + buffer)
    }
  }

  const visibleItems = computed(() => {
    const { start, end } = getVisibleRange()
    
    return items.value.slice(start, end).map((item, index) => ({
      ...item,
      index: start + index,
      offset: itemOffsets.value.get(start + index) || 0
    }))
  })

  // Item height measurement
  const measureItem = (index, element) => {
    if (!element || measuredItems.value.has(index)) return

    const height = element.offsetHeight
    itemHeights.value.set(index, height)
    measuredItems.value.add(index)
    
    // Recalculate layout after measurement
    nextTick(() => {
      calculateLayout()
    })
  }

  // Scroll handler
  const updateScrollPosition = performanceThrottle((event) => {
    scrollTop.value = event.target.scrollTop
  }, 16, 'dynamicVirtualScroll')

  // Public methods
  const scrollToIndex = (index) => {
    if (!containerRef.value) return
    
    const offset = itemOffsets.value.get(index) || 0
    containerRef.value.scrollTop = offset
  }

  const resetCache = () => {
    itemHeights.value.clear()
    itemOffsets.value.clear()
    measuredItems.value.clear()
  }

  // Lifecycle
  onMounted(() => {
    if (containerRef.value) {
      containerRef.value.addEventListener('scroll', updateScrollPosition, { passive: true })
    }
    calculateLayout()
  })

  onUnmounted(() => {
    if (containerRef.value) {
      containerRef.value.removeEventListener('scroll', updateScrollPosition)
    }
  })

  return {
    containerRef,
    visibleItems,
    totalHeight,
    scrollTop,
    measureItem,
    scrollToIndex,
    resetCache
  }
}

/**
 * Infinite scrolling with performance optimizations
 */
export function useInfiniteScroll(options = {}) {
  const {
    loadMore,
    threshold = 200,
    items = ref([]),
    isLoading = ref(false),
    hasMore = ref(true)
  } = options

  const containerRef = ref(null)
  const isLoadingMore = ref(false)

  const checkScrollPosition = performanceThrottle((event) => {
    if (isLoading.value || isLoadingMore.value || !hasMore.value) return

    const { scrollTop, scrollHeight, clientHeight } = event.target
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight

    if (distanceFromBottom < threshold) {
      loadMoreItems()
    }
  }, 100, 'infiniteScroll')

  const loadMoreItems = async () => {
    if (isLoadingMore.value || !hasMore.value) return

    isLoadingMore.value = true
    
    try {
      const tracker = trackComponentPerformance('infiniteScroll', 'loadMore')
      await loadMore()
      tracker.end()
    } catch (error) {
      console.error('Error loading more items:', error)
    } finally {
      isLoadingMore.value = false
    }
  }

  onMounted(() => {
    if (containerRef.value) {
      containerRef.value.addEventListener('scroll', checkScrollPosition, { passive: true })
    }
  })

  onUnmounted(() => {
    if (containerRef.value) {
      containerRef.value.removeEventListener('scroll', checkScrollPosition)
    }
  })

  return {
    containerRef,
    isLoadingMore,
    loadMoreItems
  }
}

/**
 * Smooth scrolling utility with performance tracking
 */
export function useSmoothScroll() {
  const isScrolling = ref(false)

  const smoothScrollTo = (element, top, duration = 300) => {
    if (isScrolling.value) return Promise.resolve()

    return new Promise((resolve) => {
      const tracker = trackComponentPerformance('smoothScroll', 'animation')
      isScrolling.value = true
      
      const startTop = element.scrollTop
      const distance = top - startTop
      const startTime = performance.now()

      const animateScroll = (currentTime) => {
        const elapsed = currentTime - startTime
        const progress = Math.min(elapsed / duration, 1)
        
        // Easing function (ease-out)
        const easeOut = 1 - Math.pow(1 - progress, 3)
        
        element.scrollTop = startTop + distance * easeOut

        if (progress < 1) {
          requestAnimationFrame(animateScroll)
        } else {
          isScrolling.value = false
          tracker.end()
          resolve()
        }
      }

      requestAnimationFrame(animateScroll)
    })
  }

  return {
    isScrolling,
    smoothScrollTo
  }
}

export default {
  useVirtualScroll,
  useVirtualGrid,
  useDynamicVirtualScroll,
  useInfiniteScroll,
  useSmoothScroll
}