import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import QuizView from '../../src/components/QuizView.vue'
import { emptyQuestions, invalidQuestions, singleQuestion } from '../fixtures/testQuestions.js'

describe('QuizView.vue - 邊界情況測試', () => {
  describe('空題目列表測試', () => {
    let wrapper

    beforeEach(async () => {
      // Mock 空題目資料
      vi.doMock('../../src/assets/questions.json', () => ({
        default: emptyQuestions
      }))
      
      // 重新導入組件
      const module = await import('../../src/components/QuizView.vue')
      wrapper = mount(module.default)
    })

    afterEach(() => {
      if (wrapper) {
        wrapper.unmount()
      }
      vi.doUnmock('../../src/assets/questions.json')
    })

    it('空題目時應該正確處理', () => {
      expect(wrapper.vm.questions).toEqual([])
      expect(wrapper.vm.questions.length).toBe(0)
    })

    it('空題目時 currentQuestion 應該返回 undefined', () => {
      expect(wrapper.vm.currentQuestion).toBeUndefined()
    })

    it('空題目時應該顯示0題', () => {
      const questionNumber = wrapper.find('.question-number')
      expect(questionNumber.text()).toContain('第 1 題，共 0 題')
    })

    it('空題目時不應該顯示題目內容', () => {
      const questionText = wrapper.find('.question-text')
      expect(questionText.text()).toBe('')
    })

    it('空題目時不應該顯示選項', () => {
      const optionsContainer = wrapper.find('.options-container')
      expect(optionsContainer.exists()).toBe(false)
    })

    it('空題目時 isQuizComplete 應該為 true', () => {
      expect(wrapper.vm.isQuizComplete).toBe(true)
    })

    it('空題目時 scorePercentage 應該返回0', () => {
      expect(wrapper.vm.scorePercentage).toBe(0)
    })

    it('空題目時應該立即顯示完成訊息', () => {
      const completionMessage = wrapper.find('.completion-message')
      expect(completionMessage.exists()).toBe(true)
      expect(completionMessage.find('h2').text()).toContain('測驗完成！')
    })
  })

  describe('單一題目測試', () => {
    let wrapper

    beforeEach(async () => {
      // Mock 單一題目資料
      vi.doMock('../../src/assets/questions.json', () => ({
        default: singleQuestion
      }))
      
      // 重新導入組件
      const module = await import('../../src/components/QuizView.vue')
      wrapper = mount(module.default)
    })

    afterEach(() => {
      if (wrapper) {
        wrapper.unmount()
      }
      vi.doUnmock('../../src/assets/questions.json')
    })

    it('單一題目應該正確顯示', () => {
      expect(wrapper.vm.questions.length).toBe(1)
      const questionNumber = wrapper.find('.question-number')
      expect(questionNumber.text()).toContain('第 1 題，共 1 題')
    })

    it('完成單一題目後應該立即顯示完成訊息', async () => {
      const optionA = wrapper.findAll('.option-button')[0]
      await optionA.trigger('click')
      
      expect(wrapper.vm.isQuizComplete).toBe(true)
      const completionMessage = wrapper.find('.completion-message')
      expect(completionMessage.exists()).toBe(true)
    })

    it('單一題目不應該顯示下一題按鈕', async () => {
      const optionA = wrapper.findAll('.option-button')[0]
      await optionA.trigger('click')
      
      const nextButton = wrapper.find('.next-button')
      expect(nextButton.exists()).toBe(false)
    })
  })

  describe('無效題目資料測試', () => {
    let wrapper

    beforeEach(async () => {
      // Mock 無效題目資料
      vi.doMock('../../src/assets/questions.json', () => ({
        default: invalidQuestions
      }))
      
      // 重新導入組件
      const module = await import('../../src/components/QuizView.vue')
      wrapper = mount(module.default)
    })

    afterEach(() => {
      if (wrapper) {
        wrapper.unmount()
      }
      vi.doUnmock('../../src/assets/questions.json')
    })

    it('無效題目應該能載入但顯示異常', () => {
      expect(wrapper.vm.questions).toEqual(invalidQuestions)
      expect(wrapper.vm.questions.length).toBe(3)
    })

    it('缺少選項的題目應該安全處理', () => {
      wrapper.vm.currentQuestionIndex = 0 // 第一個無效題目
      
      const currentQuestion = wrapper.vm.currentQuestion
      expect(currentQuestion.options).toBeUndefined()
      
      // v-if="currentQuestion" 應該阻止選項渲染
      const optionsContainer = wrapper.find('.options-container')
      expect(optionsContainer.exists()).toBe(false)
    })

    it('空題目文字應該顯示空字串', () => {
      wrapper.vm.currentQuestionIndex = 2 // 第三個無效題目（空字串）
      await wrapper.vm.$nextTick()
      
      const questionText = wrapper.find('.question-text')
      expect(questionText.text()).toBe('')
    })

    it('選擇不存在的答案選項應該安全處理', async () => {
      wrapper.vm.currentQuestionIndex = 1 // 第二個無效題目
      await wrapper.vm.$nextTick()
      
      // 嘗試選擇答案B，但正確答案B不在選項中
      wrapper.vm.selectAnswer('B')
      expect(wrapper.vm.selectedAnswer).toBe('B')
      expect(wrapper.vm.score).toBe(0) // 由於答案驗證失敗，分數不應增加
    })
  })

  describe('極端分數測試', () => {
    let wrapper

    beforeEach(async () => {
      // 使用正常題目進行分數測試
      vi.doMock('../../src/assets/questions.json', () => ({
        default: singleQuestion
      }))
      
      const module = await import('../../src/components/QuizView.vue')
      wrapper = mount(module.default)
    })

    afterEach(() => {
      if (wrapper) {
        wrapper.unmount()
      }
      vi.doUnmock('../../src/assets/questions.json')
    })

    it('滿分應該顯示100%', async () => {
      const optionA = wrapper.findAll('.option-button')[0] // 正確答案
      await optionA.trigger('click')
      
      expect(wrapper.vm.score).toBe(1)
      expect(wrapper.vm.scorePercentage).toBe(100)
      
      const scorePercentage = wrapper.find('.score-percentage')
      expect(scorePercentage.text()).toContain('正確率: 100%')
    })

    it('零分應該顯示0%', async () => {
      const optionB = wrapper.findAll('.option-button')[1] // 錯誤答案
      await optionB.trigger('click')
      
      expect(wrapper.vm.score).toBe(0)
      expect(wrapper.vm.scorePercentage).toBe(0)
      
      const scorePercentage = wrapper.find('.score-percentage')
      expect(scorePercentage.text()).toContain('正確率: 0%')
    })
  })

  describe('操作安全性測試', () => {
    let wrapper

    beforeEach(async () => {
      vi.doMock('../../src/assets/questions.json', () => ({
        default: singleQuestion
      }))
      
      const module = await import('../../src/components/QuizView.vue')
      wrapper = mount(module.default)
    })

    afterEach(() => {
      if (wrapper) {
        wrapper.unmount()
      }
      vi.doUnmock('../../src/assets/questions.json')
    })

    it('連續快速點擊選項應該只記錄一次', async () => {
      const optionA = wrapper.findAll('.option-button')[0]
      
      // 快速連續點擊
      await optionA.trigger('click')
      await optionA.trigger('click')
      await optionA.trigger('click')
      
      expect(wrapper.vm.questionsAnswered).toBe(1)
      expect(wrapper.vm.selectedAnswer).toBe('A')
    })

    it('在完成狀態下選擇答案應該無效', async () => {
      const optionA = wrapper.findAll('.option-button')[0]
      await optionA.trigger('click')
      
      // 測驗完成後
      expect(wrapper.vm.isQuizComplete).toBe(true)
      
      // 嘗試再次選擇答案
      const initialScore = wrapper.vm.score
      const initialAnswered = wrapper.vm.questionsAnswered
      
      wrapper.vm.selectAnswer('B')
      
      expect(wrapper.vm.score).toBe(initialScore)
      expect(wrapper.vm.questionsAnswered).toBe(initialAnswered)
    })

    it('nextQuestion 在最後一題時應該無效', async () => {
      const optionA = wrapper.findAll('.option-button')[0]
      await optionA.trigger('click')
      
      const initialIndex = wrapper.vm.currentQuestionIndex
      wrapper.vm.nextQuestion()
      
      // 由於只有一題，索引不應該改變
      expect(wrapper.vm.currentQuestionIndex).toBe(initialIndex)
    })
  })

  describe('記憶體洩漏防護測試', () => {
    it('組件銷毀時應該清理事件監聽器', () => {
      const wrapper = mount(QuizView)
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')
      
      wrapper.unmount()
      
      // 檢查是否有清理事件監聽器（如果組件有使用的話）
      expect(removeEventListenerSpy).toHaveBeenCalled()
      removeEventListenerSpy.mockRestore()
    })

    it('大量資料應該能正常處理', async () => {
      // 創建大量題目資料
      const largeQuestions = Array.from({ length: 1000 }, (_, index) => ({
        id: `large-${index}`,
        question: `大量測試題目 ${index}`,
        options: {
          A: `選項A-${index}`,
          B: `選項B-${index}`,
          C: `選項C-${index}`,
          D: `選項D-${index}`
        },
        answer: 'A'
      }))

      vi.doMock('../../src/assets/questions.json', () => ({
        default: largeQuestions
      }))

      const module = await import('../../src/components/QuizView.vue')
      const wrapper = mount(module.default)
      
      expect(wrapper.vm.questions.length).toBe(1000)
      expect(wrapper.vm.currentQuestion).toEqual(largeQuestions[0])
      
      wrapper.unmount()
      vi.doUnmock('../../src/assets/questions.json')
    })
  })
})