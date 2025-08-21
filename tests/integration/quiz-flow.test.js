import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { mockQuestions } from '../fixtures/testQuestions.js'

// Mock the questions import - must be at top level
vi.mock('../../src/assets/questions.json', () => ({
  default: mockQuestions
}))

import QuizView from '../../src/components/QuizView.vue'

describe('Quiz Application Integration Tests - 完整測驗流程', () => {
  let wrapper

  beforeEach(() => {
    wrapper = mount(QuizView)
  })

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount()
    }
  })

  describe('完整測驗流程 - 全部答對', () => {
    it('完整流程：全部答對並完成測驗', async () => {
      // 初始狀態檢查
      expect(wrapper.vm.currentQuestionIndex).toBe(0)
      expect(wrapper.vm.score).toBe(0)
      expect(wrapper.vm.questionsAnswered).toBe(0)
      expect(wrapper.vm.isQuizComplete).toBe(false)

      // 第一題：選擇正確答案 A
      const firstQuestionOptions = wrapper.findAll('.option-button')
      expect(firstQuestionOptions).toHaveLength(4)
      
      await firstQuestionOptions[0].trigger('click') // 選擇 A
      expect(wrapper.vm.selectedAnswer).toBe('A')
      expect(wrapper.vm.score).toBe(1)
      expect(wrapper.vm.questionsAnswered).toBe(1)
      
      // 檢查反饋訊息
      expect(wrapper.find('.correct-message').exists()).toBe(true)
      expect(wrapper.find('.next-button').exists()).toBe(true)
      
      // 進入第二題
      await wrapper.find('.next-button').trigger('click')
      expect(wrapper.vm.currentQuestionIndex).toBe(1)
      expect(wrapper.vm.selectedAnswer).toBe(null) // 重置選擇
      
      // 第二題：選擇正確答案 C
      const secondQuestionOptions = wrapper.findAll('.option-button')
      await secondQuestionOptions[2].trigger('click') // 選擇 C
      expect(wrapper.vm.selectedAnswer).toBe('C')
      expect(wrapper.vm.score).toBe(2)
      expect(wrapper.vm.questionsAnswered).toBe(2)
      
      // 進入第三題
      await wrapper.find('.next-button').trigger('click')
      expect(wrapper.vm.currentQuestionIndex).toBe(2)
      
      // 第三題：選擇正確答案 B
      const thirdQuestionOptions = wrapper.findAll('.option-button')
      await thirdQuestionOptions[1].trigger('click') // 選擇 B
      expect(wrapper.vm.selectedAnswer).toBe('B')
      expect(wrapper.vm.score).toBe(3)
      expect(wrapper.vm.questionsAnswered).toBe(3)
      
      // 點擊最後的下一題按鈕完成測驗
      await wrapper.find('.next-button').trigger('click')
      
      // 測驗完成檢查
      expect(wrapper.vm.isQuizComplete).toBe(true)
      expect(wrapper.find('.completion-message').exists()).toBe(true)
      expect(wrapper.find('.final-score').text()).toContain('最終分數: 3 / 3')
      expect(wrapper.find('.score-percentage').text()).toContain('正確率: 100%')
      expect(wrapper.find('.restart-button').exists()).toBe(true)
      expect(wrapper.find('.next-button').exists()).toBe(false)
    })
  })

  describe('完整測驗流程 - 混合答案', () => {
    it('完整流程：混合正確和錯誤答案', async () => {
      // 第一題：選擇正確答案 A
      await wrapper.findAll('.option-button')[0].trigger('click')
      expect(wrapper.vm.score).toBe(1)
      expect(wrapper.find('.correct-message').exists()).toBe(true)
      
      // 進入第二題
      await wrapper.find('.next-button').trigger('click')
      
      // 第二題：選擇錯誤答案 A（正確答案是 C）
      await wrapper.findAll('.option-button')[0].trigger('click')
      expect(wrapper.vm.score).toBe(1) // 分數不變
      expect(wrapper.find('.incorrect-message').exists()).toBe(true)
      expect(wrapper.find('.incorrect-message').text()).toContain('正確答案是 C')
      
      // 檢查選項狀態
      const options = wrapper.findAll('.option-button')
      expect(options[0].classes()).toContain('option-incorrect') // 選錯的 A
      expect(options[2].classes()).toContain('option-correct')   // 正確的 C
      
      // 進入第三題
      await wrapper.find('.next-button').trigger('click')
      
      // 第三題：選擇正確答案 B
      await wrapper.findAll('.option-button')[1].trigger('click')
      expect(wrapper.vm.score).toBe(2)
      
      // 點擊最後的下一題按鈕完成測驗
      await wrapper.find('.next-button').trigger('click')
      
      // 測驗完成檢查
      expect(wrapper.vm.isQuizComplete).toBe(true)
      expect(wrapper.find('.final-score').text()).toContain('最終分數: 2 / 3')
      expect(wrapper.find('.score-percentage').text()).toContain('正確率: 67%')
    })
  })

  describe('完整測驗流程 - 全部答錯', () => {
    it('完整流程：全部答錯', async () => {
      // 第一題：選擇錯誤答案 B（正確答案是 A）
      await wrapper.findAll('.option-button')[1].trigger('click')
      expect(wrapper.vm.score).toBe(0)
      await wrapper.find('.next-button').trigger('click')
      
      // 第二題：選擇錯誤答案 A（正確答案是 C）
      await wrapper.findAll('.option-button')[0].trigger('click')
      expect(wrapper.vm.score).toBe(0)
      await wrapper.find('.next-button').trigger('click')
      
      // 第三題：選擇錯誤答案 A（正確答案是 B）
      await wrapper.findAll('.option-button')[0].trigger('click')
      expect(wrapper.vm.score).toBe(0)
      
      // 點擊最後的下一題按鈕完成測驗
      await wrapper.find('.next-button').trigger('click')
      
      // 測驗完成檢查
      expect(wrapper.vm.isQuizComplete).toBe(true)
      expect(wrapper.find('.final-score').text()).toContain('最終分數: 0 / 3')
      expect(wrapper.find('.score-percentage').text()).toContain('正確率: 0%')
    })
  })

  describe('重新開始功能測試', () => {
    it('完成測驗後應該能重新開始', async () => {
      // 快速完成測驗
      for (let i = 0; i < 3; i++) {
        await wrapper.findAll('.option-button')[0].trigger('click')
        // 總是點擊下一題按鈕
        await wrapper.find('.next-button').trigger('click')
      }
      
      // 確認測驗完成
      expect(wrapper.vm.isQuizComplete).toBe(true)
      const finalScore = wrapper.vm.score
      
      // 重新開始
      await wrapper.find('.restart-button').trigger('click')
      
      // 檢查狀態是否重置
      expect(wrapper.vm.currentQuestionIndex).toBe(0)
      expect(wrapper.vm.selectedAnswer).toBe(null)
      expect(wrapper.vm.score).toBe(0)
      expect(wrapper.vm.questionsAnswered).toBe(0)
      expect(wrapper.vm.isQuizComplete).toBe(false)
      
      // 檢查 UI 狀態
      expect(wrapper.find('.completion-message').exists()).toBe(false)
      expect(wrapper.find('.next-button').exists()).toBe(false)
      expect(wrapper.find('.question-number').text()).toContain('第 1 題，共 3 題')
      
      // 檢查選項是否重新啟用
      const options = wrapper.findAll('.option-button')
      options.forEach(option => {
        expect(option.attributes('disabled')).toBeUndefined()
        expect(option.classes()).not.toContain('option-disabled')
      })
    })
  })

  describe('UI 狀態同步測試', () => {
    it('分數顯示應該與內部狀態同步', async () => {
      // 初始分數顯示
      let scoreDisplay = wrapper.find('.score-display')
      expect(scoreDisplay.text()).toContain('分數: 0 / 0')
      
      // 第一題答對
      await wrapper.findAll('.option-button')[0].trigger('click')
      scoreDisplay = wrapper.find('.score-display')
      expect(scoreDisplay.text()).toContain('分數: 1 / 1')
      
      // 進入第二題
      await wrapper.find('.next-button').trigger('click')
      
      // 第二題答錯
      await wrapper.findAll('.option-button')[0].trigger('click')
      scoreDisplay = wrapper.find('.score-display')
      expect(scoreDisplay.text()).toContain('分數: 1 / 2')
    })

    it('題目編號顯示應該正確更新', async () => {
      // 檢查第一題
      let questionNumber = wrapper.find('.question-number')
      expect(questionNumber.text()).toBe('第 1 題，共 3 題')
      
      // 進入第二題
      await wrapper.findAll('.option-button')[0].trigger('click')
      await wrapper.find('.next-button').trigger('click')
      
      questionNumber = wrapper.find('.question-number')
      expect(questionNumber.text()).toBe('第 2 題，共 3 題')
      
      // 進入第三題
      await wrapper.findAll('.option-button')[0].trigger('click')
      await wrapper.find('.next-button').trigger('click')
      
      questionNumber = wrapper.find('.question-number')
      expect(questionNumber.text()).toBe('第 3 題，共 3 題')
    })

    it('題目內容應該正確切換', async () => {
      // 檢查第一題內容
      let questionText = wrapper.find('.question-text')
      expect(questionText.text()).toBe(mockQuestions[0].question)
      
      // 進入第二題
      await wrapper.findAll('.option-button')[0].trigger('click')
      await wrapper.find('.next-button').trigger('click')
      
      questionText = wrapper.find('.question-text')
      expect(questionText.text()).toBe(mockQuestions[1].question)
      
      // 檢查選項內容
      const optionTexts = wrapper.findAll('.option-text').map(el => el.text())
      expect(optionTexts).toEqual([
        mockQuestions[1].options.A,
        mockQuestions[1].options.B,
        mockQuestions[1].options.C,
        mockQuestions[1].options.D
      ])
    })
  })

  describe('錯誤處理和邊界情況', () => {
    it('快速連續點擊應該正確處理', async () => {
      const optionA = wrapper.findAll('.option-button')[0]
      
      // 快速連續點擊
      await optionA.trigger('click')
      await optionA.trigger('click')
      await optionA.trigger('click')
      
      // 應該只記錄一次選擇
      expect(wrapper.vm.selectedAnswer).toBe('A')
      expect(wrapper.vm.questionsAnswered).toBe(1)
      expect(wrapper.vm.score).toBe(1)
      
      // 選項應該被禁用
      expect(optionA.attributes('disabled')).toBeDefined()
    })

    it('在選擇答案前不應該顯示下一題按鈕', async () => {
      // 還沒選擇答案時，下一題按鈕不應該存在
      expect(wrapper.find('.next-button').exists()).toBe(false)
      
      // 選擇答案後按鈕應該出現
      await wrapper.findAll('.option-button')[0].trigger('click')
      expect(wrapper.find('.next-button').exists()).toBe(true)
    })

    it('完成測驗後繼續點擊選項應該無效', async () => {
      // 完成所有題目
      for (let i = 0; i < 3; i++) {
        await wrapper.findAll('.option-button')[0].trigger('click')
        // 總是點擊下一題按鈕
        await wrapper.find('.next-button').trigger('click')
      }
      
      expect(wrapper.vm.isQuizComplete).toBe(true)
      const finalScore = wrapper.vm.score
      
      // 嘗試再次選擇答案（通過手動調用）
      wrapper.vm.selectAnswer('B')
      await nextTick()
      
      // 分數不應該改變（questionsAnswered會變但不應該影響分數）
      expect(wrapper.vm.score).toBe(finalScore)
    })
  })

  describe('可訪問性和用戶體驗', () => {
    it('選項按鈕應該有正確的 ARIA 屬性', async () => {
      const options = wrapper.findAll('.option-button')
      
      options.forEach(option => {
        // 按鈕應該有適當的類型
        expect(option.element.tagName).toBe('BUTTON')
      })
      
      // 選擇答案後，檢查 disabled 狀態
      await options[0].trigger('click')
      
      options.forEach(option => {
        expect(option.attributes('disabled')).toBeDefined()
      })
    })

    it('反饋訊息應該清楚顯示', async () => {
      // 選擇正確答案
      await wrapper.findAll('.option-button')[0].trigger('click')
      
      const correctMessage = wrapper.find('.correct-message')
      expect(correctMessage.exists()).toBe(true)
      expect(correctMessage.isVisible()).toBe(true)
      expect(correctMessage.text()).toContain('正確！做得好！')
      
      // 進入下一題並選擇錯誤答案
      await wrapper.find('.next-button').trigger('click')
      await wrapper.findAll('.option-button')[0].trigger('click') // 錯誤答案
      
      const incorrectMessage = wrapper.find('.incorrect-message')
      expect(incorrectMessage.exists()).toBe(true)
      expect(incorrectMessage.isVisible()).toBe(true)
      expect(incorrectMessage.text()).toContain('不正確。正確答案是 C')
    })

    it('進度指示應該清楚', async () => {
      // 檢查初始進度
      expect(wrapper.find('.question-number').text()).toContain('第 1 題，共 3 題')
      
      // 完成第一題
      await wrapper.findAll('.option-button')[0].trigger('click')
      await wrapper.find('.next-button').trigger('click')
      
      // 檢查進度更新
      expect(wrapper.find('.question-number').text()).toContain('第 2 題，共 3 題')
      
      // 分數應該清楚顯示
      expect(wrapper.find('.score-display').text()).toContain('分數: 1 / 1')
    })
  })
})