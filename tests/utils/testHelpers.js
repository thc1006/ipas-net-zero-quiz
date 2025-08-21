import { mount } from '@vue/test-utils'
import { vi } from 'vitest'
import { mockQuestions } from '../fixtures/testQuestions.js'

/**
 * 測試輔助工具類
 * 提供常用的測試功能和簡化測試設置
 */

/**
 * 創建 Vue 組件測試包裝器的輔助函數
 * @param {Object} component - Vue 組件
 * @param {Object} options - 掛載選項
 * @returns {Object} wrapper - 測試包裝器
 */
export function createWrapper(component, options = {}) {
  const defaultOptions = {
    global: {
      stubs: {
        // 如果需要 stub 某些子組件
      },
      mocks: {
        // 如果需要 mock 某些全域物件
      }
    }
  }
  
  return mount(component, {
    ...defaultOptions,
    ...options
  })
}

/**
 * 模擬 localStorage 的輔助函數
 * @returns {Object} 模擬的 localStorage 物件
 */
export function mockLocalStorage() {
  const store = new Map()
  
  return {
    getItem: vi.fn((key) => store.get(key) || null),
    setItem: vi.fn((key, value) => store.set(key, value)),
    removeItem: vi.fn((key) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
    length: store.size,
    key: vi.fn((index) => Array.from(store.keys())[index] || null)
  }
}

/**
 * 完成整個測驗的輔助函數
 * @param {Object} wrapper - 組件包裝器
 * @param {Array} answers - 答案陣列，例如 ['A', 'C', 'B']
 * @returns {Promise} 完成後的 Promise
 */
export async function completeQuiz(wrapper, answers = ['A', 'A', 'A']) {
  for (let i = 0; i < answers.length; i++) {
    const answer = answers[i]
    const optionIndex = answer.charCodeAt(0) - 65 // A=0, B=1, C=2, D=3
    
    // 選擇答案
    const options = wrapper.findAll('.option-button')
    if (options[optionIndex]) {
      await options[optionIndex].trigger('click')
    }
    
    // 如果不是最後一題，點擊下一題
    if (i < answers.length - 1) {
      const nextButton = wrapper.find('.next-button')
      if (nextButton.exists()) {
        await nextButton.trigger('click')
      }
    }
  }
}

/**
 * 等待 Vue 響應式更新完成
 * @param {Object} wrapper - 組件包裝器
 * @param {number} ticks - 等待的 tick 數量
 * @returns {Promise}
 */
export async function waitForUpdates(wrapper, ticks = 1) {
  for (let i = 0; i < ticks; i++) {
    await wrapper.vm.$nextTick()
  }
}

/**
 * 驗證測驗完成狀態的輔助函數
 * @param {Object} wrapper - 組件包裝器
 * @param {number} expectedScore - 期望分數
 * @param {number} totalQuestions - 總題數
 */
export function expectQuizCompleted(wrapper, expectedScore, totalQuestions) {
  expect(wrapper.vm.isQuizComplete).toBe(true)
  expect(wrapper.find('.completion-message').exists()).toBe(true)
  expect(wrapper.find('.final-score').text()).toContain(`最終分數: ${expectedScore} / ${totalQuestions}`)
  expect(wrapper.find('.restart-button').exists()).toBe(true)
  expect(wrapper.find('.next-button').exists()).toBe(false)
  
  const expectedPercentage = Math.round((expectedScore / totalQuestions) * 100)
  expect(wrapper.find('.score-percentage').text()).toContain(`正確率: ${expectedPercentage}%`)
}

/**
 * 驗證答案選擇狀態的輔助函數
 * @param {Object} wrapper - 組件包裝器
 * @param {string} selectedAnswer - 選擇的答案
 * @param {string} correctAnswer - 正確答案
 * @param {boolean} isCorrect - 是否正確
 */
export function expectAnswerState(wrapper, selectedAnswer, correctAnswer, isCorrect) {
  expect(wrapper.vm.selectedAnswer).toBe(selectedAnswer)
  
  if (isCorrect) {
    expect(wrapper.find('.correct-message').exists()).toBe(true)
    expect(wrapper.find('.correct-message').text()).toContain('正確！做得好！')
  } else {
    expect(wrapper.find('.incorrect-message').exists()).toBe(true)
    expect(wrapper.find('.incorrect-message').text()).toContain(`正確答案是 ${correctAnswer}`)
  }
  
  // 檢查選項狀態
  const options = wrapper.findAll('.option-button')
  options.forEach((option, index) => {
    const optionKey = String.fromCharCode(65 + index) // A, B, C, D
    
    if (optionKey === correctAnswer) {
      expect(option.classes()).toContain('option-correct')
      expect(option.find('.feedback-icon').text()).toBe('✓')
    } else if (optionKey === selectedAnswer && !isCorrect) {
      expect(option.classes()).toContain('option-incorrect')
      expect(option.find('.feedback-icon').text()).toBe('✗')
    }
    
    // 所有選項都應該被禁用
    expect(option.attributes('disabled')).toBeDefined()
  })
}

/**
 * 生成測試題目資料的輔助函數
 * @param {number} count - 題目數量
 * @param {string} prefix - ID 前綴
 * @returns {Array} 題目陣列
 */
export function generateTestQuestions(count = 3, prefix = 'test') {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${String(index + 1).padStart(3, '0')}`,
    subject: '測試科目',
    question: `這是第${index + 1}個測試題目？`,
    options: {
      A: `第${index + 1}題選項A`,
      B: `第${index + 1}題選項B`,
      C: `第${index + 1}題選項C`,
      D: `第${index + 1}題選項D`
    },
    answer: ['A', 'B', 'C', 'D'][index % 4], // 循環分配正確答案
    explanation: `這是第${index + 1}題的解釋`
  }))
}

/**
 * 模擬計時器的輔助函數
 * @param {number} seconds - 要前進的秒數
 */
export function advanceTimers(seconds) {
  vi.advanceTimersByTime(seconds * 1000)
}

/**
 * 重置所有 mocks 的輔助函數
 */
export function resetAllMocks() {
  vi.clearAllMocks()
  localStorage.clear()
}

/**
 * 設置測試環境的輔助函數
 * @param {Object} options - 環境設定選項
 */
export function setupTestEnvironment(options = {}) {
  const {
    useFakeTimers = false,
    mockLocalStorage: shouldMockLocalStorage = true
  } = options
  
  if (useFakeTimers) {
    vi.useFakeTimers()
  }
  
  if (shouldMockLocalStorage) {
    Object.defineProperty(global, 'localStorage', {
      value: mockLocalStorage(),
      writable: true
    })
  }
}

/**
 * 清理測試環境的輔助函數
 */
export function cleanupTestEnvironment() {
  vi.useRealTimers()
  resetAllMocks()
}

/**
 * 驗證元素可見性的輔助函數
 * @param {Object} wrapper - 組件包裝器
 * @param {string} selector - CSS 選擇器
 * @param {boolean} shouldBeVisible - 期望是否可見
 */
export function expectElementVisibility(wrapper, selector, shouldBeVisible = true) {
  const element = wrapper.find(selector)
  
  if (shouldBeVisible) {
    expect(element.exists()).toBe(true)
    expect(element.isVisible()).toBe(true)
  } else {
    expect(element.exists()).toBe(false)
  }
}

/**
 * 驗證按鈕狀態的輔助函數
 * @param {Object} button - 按鈕元素
 * @param {boolean} shouldBeDisabled - 期望是否禁用
 */
export function expectButtonState(button, shouldBeDisabled = false) {
  expect(button.exists()).toBe(true)
  
  if (shouldBeDisabled) {
    expect(button.attributes('disabled')).toBeDefined()
  } else {
    expect(button.attributes('disabled')).toBeUndefined()
  }
}

/**
 * 取得正確答案對應的選項索引
 * @param {string} answer - 答案字母 (A, B, C, D)
 * @returns {number} 選項索引 (0, 1, 2, 3)
 */
export function getOptionIndex(answer) {
  return answer.charCodeAt(0) - 65
}

/**
 * 驗證分數顯示的輔助函數
 * @param {Object} wrapper - 組件包裝器
 * @param {number} score - 當前分數
 * @param {number} answered - 已回答題數
 */
export function expectScoreDisplay(wrapper, score, answered) {
  const scoreDisplay = wrapper.find('.score-display')
  expect(scoreDisplay.exists()).toBe(true)
  expect(scoreDisplay.text()).toContain(`分數: ${score} / ${answered}`)
}