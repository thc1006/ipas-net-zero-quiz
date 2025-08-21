import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mockQuestions, emptyQuestions, invalidQuestions, singleQuestion } from '../fixtures/testQuestions.js'

// Mock the questions.json import - must be at top level
vi.mock('../../src/assets/questions.json', () => ({
  default: mockQuestions
}))

import QuizView from '../../src/components/QuizView.vue'

describe('QuizView.vue', () => {
  let wrapper

  beforeEach(() => {
    // 在每次測試前重新掛載組件
    wrapper = mount(QuizView)
  })

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount()
    }
  })

  describe('初始化狀態測試', () => {
    it('應該正確載入題目資料', () => {
      expect(wrapper.vm.questions).toEqual(mockQuestions)
      expect(wrapper.vm.questions.length).toBe(3)
    })

    it('應該顯示第一題', () => {
      expect(wrapper.vm.currentQuestionIndex).toBe(0)
      expect(wrapper.vm.currentQuestion).toEqual(mockQuestions[0])
    })

    it('應該顯示正確的題目編號', () => {
      const questionNumber = wrapper.find('.question-number')
      expect(questionNumber.text()).toContain('第 1 題，共 3 題')
    })

    it('應該顯示題目內容', () => {
      const questionText = wrapper.find('.question-text')
      expect(questionText.text()).toBe(mockQuestions[0].question)
    })

    it('應該顯示所有選項', () => {
      const options = wrapper.findAll('.option-button')
      expect(options).toHaveLength(4)
      
      const optionTexts = options.map(option => option.find('.option-text').text())
      expect(optionTexts).toEqual([
        mockQuestions[0].options.A,
        mockQuestions[0].options.B,
        mockQuestions[0].options.C,
        mockQuestions[0].options.D
      ])
    })

    it('初始分數應該為0', () => {
      expect(wrapper.vm.score).toBe(0)
      expect(wrapper.vm.questionsAnswered).toBe(0)
      
      const scoreDisplay = wrapper.find('.score-display')
      expect(scoreDisplay.text()).toContain('分數: 0 / 0')
    })

    it('初始狀態不應該顯示下一題按鈕', () => {
      const nextButton = wrapper.find('.next-button')
      expect(nextButton.exists()).toBe(false)
    })

    it('初始狀態不應該顯示完成訊息', () => {
      const completionMessage = wrapper.find('.completion-message')
      expect(completionMessage.exists()).toBe(false)
    })
  })

  describe('答案選擇測試', () => {
    it('應該能選擇答案', async () => {
      const optionA = wrapper.findAll('.option-button')[0]
      await optionA.trigger('click')
      
      expect(wrapper.vm.selectedAnswer).toBe('A')
      expect(wrapper.vm.questionsAnswered).toBe(1)
    })

    it('選擇正確答案應該增加分數', async () => {
      // 第一題正確答案是A
      const optionA = wrapper.findAll('.option-button')[0]
      await optionA.trigger('click')
      
      expect(wrapper.vm.score).toBe(1)
      expect(wrapper.find('.correct-message').exists()).toBe(true)
      expect(wrapper.find('.correct-message').text()).toContain('正確！做得好！')
    })

    it('選擇錯誤答案不應該增加分數', async () => {
      // 選擇錯誤答案B
      const optionB = wrapper.findAll('.option-button')[1]
      await optionB.trigger('click')
      
      expect(wrapper.vm.score).toBe(0)
      expect(wrapper.vm.questionsAnswered).toBe(1)
      expect(wrapper.find('.incorrect-message').exists()).toBe(true)
      expect(wrapper.find('.incorrect-message').text()).toContain('不正確。正確答案是 A')
    })

    it('選擇答案後應該顯示下一題按鈕', async () => {
      const optionA = wrapper.findAll('.option-button')[0]
      await optionA.trigger('click')
      
      const nextButton = wrapper.find('.next-button')
      expect(nextButton.exists()).toBe(true)
      expect(nextButton.text()).toContain('下一題')
    })

    it('選擇答案後選項應該被禁用', async () => {
      const optionA = wrapper.findAll('.option-button')[0]
      await optionA.trigger('click')
      
      const options = wrapper.findAll('.option-button')
      options.forEach(option => {
        expect(option.attributes('disabled')).toBeDefined()
        expect(option.classes()).toContain('option-disabled')
      })
    })

    it('選擇答案後應該顯示正確答案標記', async () => {
      const optionB = wrapper.findAll('.option-button')[1] // 選擇錯誤答案
      await optionB.trigger('click')
      
      // 正確答案A應該顯示綠色標記
      const correctOption = wrapper.findAll('.option-button')[0]
      expect(correctOption.classes()).toContain('option-correct')
      expect(correctOption.find('.feedback-icon').text()).toBe('✓')
      
      // 錯誤答案B應該顯示紅色標記
      const incorrectOption = wrapper.findAll('.option-button')[1]
      expect(incorrectOption.classes()).toContain('option-incorrect')
      expect(incorrectOption.find('.feedback-icon').text()).toBe('✗')
    })

    it('已選擇答案後不應該能再次選擇', async () => {
      const optionA = wrapper.findAll('.option-button')[0]
      await optionA.trigger('click')
      
      expect(wrapper.vm.selectedAnswer).toBe('A')
      
      // 嘗試選擇其他答案
      const optionB = wrapper.findAll('.option-button')[1]
      await optionB.trigger('click')
      
      // 答案不應該改變
      expect(wrapper.vm.selectedAnswer).toBe('A')
    })
  })

  describe('題目導航測試', () => {
    beforeEach(async () => {
      // 先回答第一題
      const optionA = wrapper.findAll('.option-button')[0]
      await optionA.trigger('click')
    })

    it('應該能進入下一題', async () => {
      const nextButton = wrapper.find('.next-button')
      await nextButton.trigger('click')
      
      expect(wrapper.vm.currentQuestionIndex).toBe(1)
      expect(wrapper.vm.currentQuestion).toEqual(mockQuestions[1])
      expect(wrapper.vm.selectedAnswer).toBe(null) // 新題目答案應該重置
    })

    it('進入新題目後應該顯示正確內容', async () => {
      const nextButton = wrapper.find('.next-button')
      await nextButton.trigger('click')
      
      const questionNumber = wrapper.find('.question-number')
      expect(questionNumber.text()).toContain('第 2 題，共 3 題')
      
      const questionText = wrapper.find('.question-text')
      expect(questionText.text()).toBe(mockQuestions[1].question)
    })

    it('進入新題目後選項應該重新啟用', async () => {
      const nextButton = wrapper.find('.next-button')
      await nextButton.trigger('click')
      
      const options = wrapper.findAll('.option-button')
      options.forEach(option => {
        expect(option.attributes('disabled')).toBeUndefined()
        expect(option.classes()).not.toContain('option-disabled')
      })
    })
  })

  describe('測驗完成測試', () => {
    beforeEach(async () => {
      // 完成所有題目
      for (let i = 0; i < mockQuestions.length; i++) {
        // 回答題目（選擇A）
        const optionA = wrapper.findAll('.option-button')[0]
        await optionA.trigger('click')
        await wrapper.vm.$nextTick()
        
        // 總是點擊下一題按鈕（包括最後一題）
        const nextButton = wrapper.find('.next-button')
        if (nextButton.exists()) {
          await nextButton.trigger('click')
          await wrapper.vm.$nextTick()
        }
      }
      // 等待最終狀態更新
      await wrapper.vm.$nextTick()
    })

    it('完成所有題目後應該顯示完成訊息', () => {
      expect(wrapper.vm.isQuizComplete).toBe(true)
      const completionMessage = wrapper.find('.completion-message')
      expect(completionMessage.exists()).toBe(true)
      expect(completionMessage.find('h2').text()).toContain('測驗完成！')
    })

    it('應該顯示最終分數', () => {
      const finalScore = wrapper.find('.final-score')
      expect(finalScore.exists()).toBe(true)
      // 所有題目都選A，但只有第一題正確，所以分數是1/3
      expect(finalScore.text()).toContain('最終分數: 1 / 3')
    })

    it('應該顯示正確率百分比', () => {
      const scorePercentage = wrapper.find('.score-percentage')
      expect(scorePercentage.exists()).toBe(true)
      // 1/3 = 33%
      expect(scorePercentage.text()).toContain('正確率: 33%')
    })

    it('應該顯示重新開始按鈕', () => {
      const restartButton = wrapper.find('.restart-button')
      expect(restartButton.exists()).toBe(true)
      expect(restartButton.text()).toContain('重新開始')
    })

    it('完成後不應該顯示下一題按鈕', () => {
      const nextButton = wrapper.find('.next-button')
      expect(nextButton.exists()).toBe(false)
    })
  })

  describe('重新開始測試', () => {
    it('重新開始應該重置所有狀態', async () => {
      // 先完成一些題目
      const optionA = wrapper.findAll('.option-button')[0]
      await optionA.trigger('click')
      
      const nextButton = wrapper.find('.next-button')
      await nextButton.trigger('click')
      
      // 確認狀態已改變
      expect(wrapper.vm.currentQuestionIndex).toBe(1)
      expect(wrapper.vm.score).toBe(1)
      expect(wrapper.vm.questionsAnswered).toBe(1)
      
      // 重新開始
      wrapper.vm.restartQuiz()
      await wrapper.vm.$nextTick()
      
      // 檢查狀態是否重置
      expect(wrapper.vm.currentQuestionIndex).toBe(0)
      expect(wrapper.vm.selectedAnswer).toBe(null)
      expect(wrapper.vm.score).toBe(0)
      expect(wrapper.vm.questionsAnswered).toBe(0)
    })
  })

  describe('計算屬性測試', () => {
    it('currentQuestion 應該返回當前題目', () => {
      expect(wrapper.vm.currentQuestion).toEqual(mockQuestions[0])
      
      wrapper.vm.currentQuestionIndex = 1
      expect(wrapper.vm.currentQuestion).toEqual(mockQuestions[1])
    })

    it('isQuizComplete 應該正確判斷測驗是否完成', () => {
      expect(wrapper.vm.isQuizComplete).toBe(false)
      
      wrapper.vm.currentQuestionIndex = mockQuestions.length
      expect(wrapper.vm.isQuizComplete).toBe(true)
    })

    it('scorePercentage 應該正確計算百分比', () => {
      expect(wrapper.vm.scorePercentage).toBe(0)
      
      wrapper.vm.score = 1
      expect(wrapper.vm.scorePercentage).toBe(33) // 1/3 * 100 = 33
      
      wrapper.vm.score = 3
      expect(wrapper.vm.scorePercentage).toBe(100) // 3/3 * 100 = 100
    })

    it('空題目列表時 scorePercentage 應該返回0', () => {
      wrapper.vm.questions = []
      expect(wrapper.vm.scorePercentage).toBe(0)
    })
  })

  describe('方法測試', () => {
    it('selectAnswer 方法應該正確處理答案選擇', () => {
      expect(wrapper.vm.selectedAnswer).toBe(null)
      expect(wrapper.vm.questionsAnswered).toBe(0)
      expect(wrapper.vm.score).toBe(0)
      
      wrapper.vm.selectAnswer('A')
      
      expect(wrapper.vm.selectedAnswer).toBe('A')
      expect(wrapper.vm.questionsAnswered).toBe(1)
      expect(wrapper.vm.score).toBe(1) // A是正確答案
    })

    it('selectAnswer 在已選擇時應該無效', () => {
      wrapper.vm.selectAnswer('A')
      expect(wrapper.vm.selectedAnswer).toBe('A')
      expect(wrapper.vm.questionsAnswered).toBe(1)
      
      wrapper.vm.selectAnswer('B')
      expect(wrapper.vm.selectedAnswer).toBe('A') // 不應該改變
      expect(wrapper.vm.questionsAnswered).toBe(1) // 不應該增加
    })

    it('nextQuestion 方法應該正確進入下一題', () => {
      wrapper.vm.selectAnswer('A')
      expect(wrapper.vm.currentQuestionIndex).toBe(0)
      expect(wrapper.vm.selectedAnswer).toBe('A')
      
      wrapper.vm.nextQuestion()
      
      expect(wrapper.vm.currentQuestionIndex).toBe(1)
      expect(wrapper.vm.selectedAnswer).toBe(null)
    })
  })
})