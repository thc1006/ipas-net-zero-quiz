import { ref, watch, onMounted } from 'vue'

/**
 * Count-up animation composable
 * Provides smooth counting animation for numbers
 */
export function useCountUp(target, options = {}) {
  const {
    duration = 1500, // Animation duration in milliseconds
    delay = 0,       // Delay before starting animation
    easing = 'easeOutQuart', // Easing function
    startValue = 0   // Starting value
  } = options

  const current = ref(startValue)
  const isAnimating = ref(false)

  // Easing functions
  const easingFunctions = {
    easeOutQuart: (t) => 1 - Math.pow(1 - t, 4),
    easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
    easeOutQuad: (t) => 1 - Math.pow(1 - t, 2),
    easeInOutCubic: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    linear: (t) => t
  }

  /**
   * Animate count to target value
   */
  function countTo(targetValue, customOptions = {}) {
    const config = { ...options, ...customOptions }
    const startVal = current.value
    const endVal = Number(targetValue) || 0
    const change = endVal - startVal

    if (change === 0) return Promise.resolve()

    isAnimating.value = true

    return new Promise((resolve) => {
      const startTime = performance.now() + config.delay
      
      function animate(currentTime) {
        const elapsed = currentTime - startTime

        if (elapsed < 0) {
          requestAnimationFrame(animate)
          return
        }

        if (elapsed >= config.duration) {
          current.value = endVal
          isAnimating.value = false
          resolve()
          return
        }

        const progress = elapsed / config.duration
        const easedProgress = easingFunctions[config.easing] || easingFunctions.easeOutQuart
        const value = startVal + (change * easedProgress(progress))
        
        current.value = Math.round(value)
        requestAnimationFrame(animate)
      }

      requestAnimationFrame(animate)
    })
  }

  /**
   * Reset counter to start value
   */
  function reset() {
    current.value = startValue
    isAnimating.value = false
  }

  // Watch target value changes and animate
  watch(() => target.value, (newValue) => {
    if (newValue !== undefined && newValue !== null) {
      countTo(newValue)
    }
  })

  // Initialize with target value on mount
  onMounted(() => {
    if (target.value !== undefined && target.value !== null) {
      // Start animation after a short delay for better UX
      setTimeout(() => countTo(target.value), 300)
    }
  })

  return {
    current,
    isAnimating,
    countTo,
    reset
  }
}