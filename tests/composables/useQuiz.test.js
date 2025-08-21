import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useQuiz } from '../../src/composables/useQuiz.js'
import { mockQuestions, emptyQuestions, singleQuestion } from '../fixtures/testQuestions.js'

describe('useQuiz.js Composable', () => {
  let quiz

  beforeEach(() => {
    // 清理 localStorage
    localStorage.clear()
    vi.clearAllTimers()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('初始化測試', () => {
    it('應該正確初始化空狀態', () => {
      quiz = useQuiz()
      
      expect(quiz.questions.value).toEqual([])
      expect(quiz.currentQuestionIndex.value).toBe(0)
      expect(quiz.isQuizStarted.value).toBe(false)
      expect(quiz.isQuizCompleted.value).toBe(false)
      expect(quiz.score.value).toEqual({
        correct: 0,
        total: 0,
        percentage: 0
      })
    })

    it('應該正確初始化有題目的狀態', () => {
      quiz = useQuiz(mockQuestions)
      
      expect(quiz.questions.value).toEqual(mockQuestions)
      expect(quiz.totalQuestions.value).toBe(3)
      expect(quiz.currentQuestion.value).toEqual(mockQuestions[0])
      expect(quiz.currentQuestionNumber.value).toBe(1)
    })
  })

  describe('題目導航測試', () => {
    beforeEach(() => {
      quiz = useQuiz(mockQuestions)
      quiz.initializeQuiz()
    })

    it('應該能正確導航到下一題', () => {
      expect(quiz.canGoNext.value).toBe(true)
      
      quiz.nextQuestion()
      
      expect(quiz.currentQuestionIndex.value).toBe(1)
      expect(quiz.currentQuestion.value).toEqual(mockQuestions[1])
    })

    it('應該能正確導航到上一題', () => {
      quiz.nextQuestion() // 先到第二題
      expect(quiz.canGoPrevious.value).toBe(true)
      
      quiz.previousQuestion()
      
      expect(quiz.currentQuestionIndex.value).toBe(0)
      expect(quiz.currentQuestion.value).toEqual(mockQuestions[0])
    })

    it('第一題時不應該能回到上一題', () => {
      expect(quiz.canGoPrevious.value).toBe(false)
      
      const initialIndex = quiz.currentQuestionIndex.value
      quiz.previousQuestion()
      
      expect(quiz.currentQuestionIndex.value).toBe(initialIndex)
    })

    it('最後一題時不應該能進入下一題', () => {
      quiz.goToQuestion(2) // 直接跳到最後一題
      expect(quiz.canGoNext.value).toBe(false)
      
      const initialIndex = quiz.currentQuestionIndex.value
      quiz.nextQuestion()
      
      expect(quiz.currentQuestionIndex.value).toBe(initialIndex)
    })

    it('應該能跳轉到指定題目', () => {
      quiz.goToQuestion(1)
      
      expect(quiz.currentQuestionIndex.value).toBe(1)
      expect(quiz.currentQuestion.value).toEqual(mockQuestions[1])
    })

    it('跳轉到無效索引應該無效', () => {
      const initialIndex = quiz.currentQuestionIndex.value
      
      quiz.goToQuestion(-1)
      expect(quiz.currentQuestionIndex.value).toBe(initialIndex)
      
      quiz.goToQuestion(999)
      expect(quiz.currentQuestionIndex.value).toBe(initialIndex)
    })
  })

  describe('答題功能測試', () => {
    beforeEach(() => {
      quiz = useQuiz(mockQuestions)
      quiz.initializeQuiz()
      quiz.startQuiz()
    })

    it('應該能正確記錄答案', () => {
      quiz.answerQuestion('A')
      
      expect(quiz.currentQuestionAnswer.value).toBe('A')
      expect(quiz.isCurrentQuestionAnswered.value).toBe(true)
      expect(quiz.userAnswers.has(mockQuestions[0].id)).toBe(true)
    })

    it('正確答案應該增加分數', () => {
      quiz.answerQuestion('A') // 第一題正確答案是A
      
      expect(quiz.score.value.correct).toBe(1)
      expect(quiz.score.value.total).toBe(1)
      expect(quiz.score.value.percentage).toBe(100)
      expect(quiz.statistics.correctAnswers).toBe(1)
    })

    it('錯誤答案不應該增加分數', () => {
      quiz.answerQuestion('B') // 錯誤答案
      
      expect(quiz.score.value.correct).toBe(0)
      expect(quiz.score.value.total).toBe(1)
      expect(quiz.score.value.percentage).toBe(0)
      expect(quiz.statistics.incorrectAnswers).toBe(1)
    })

    it('應該記錄答題歷史', () => {
      quiz.answerQuestion('A')
      
      expect(quiz.answerHistory.value).toHaveLength(1)
      const history = quiz.answerHistory.value[0]
      expect(history.questionId).toBe(mockQuestions[0].id)
      expect(history.selectedAnswer).toBe('A')
      expect(history.correctAnswer).toBe('A')
      expect(history.isCorrect).toBe(true)
    })

    it('回答問題後應該自動前進到下一題', () => {
      quiz.answerQuestion('A')
      
      // 模擬延遲後的自動前進
      vi.advanceTimersByTime(1000)
      
      expect(quiz.currentQuestionIndex.value).toBe(1)
    })
  })

  describe('計時器功能測試', () => {
    beforeEach(() => {
      quiz = useQuiz(mockQuestions)
      quiz.initializeQuiz({ isTimerEnabled: true, timePerQuestion: 30 })
      quiz.startQuiz()
    })

    it('開始測驗應該啟動計時器', () => {
      expect(quiz.currentQuestionTime.value).toBe(0)
      expect(quiz.remainingTime.value).toBe(30)
      
      vi.advanceTimersByTime(5000) // 前進5秒
      
      expect(quiz.currentQuestionTime.value).toBe(5)
      expect(quiz.remainingTime.value).toBe(25)
    })

    it('時間到應該自動處理', () => {
      vi.advanceTimersByTime(30000) // 前進30秒（時間用完）
      
      expect(quiz.currentQuestionIndex.value).toBe(1) // 應該自動進入下一題
    })

    it('停用計時器時剩餘時間應該為 null', () => {
      quiz.initializeQuiz({ isTimerEnabled: false })
      quiz.startQuiz()
      
      expect(quiz.remainingTime.value).toBe(null)
      expect(quiz.isTimerEnabled.value).toBe(false)
    })

    it('formatTime 應該正確格式化時間', () => {
      // 設定啟用計時器和時間
      quiz.initializeQuiz({ isTimerEnabled: true, timePerQuestion: 90 })
      quiz.startQuiz()
      
      // 設定當前時間為25秒，剩餘65秒
      quiz.currentQuestionTime.value = 25
      
      // 65秒 = 1分5秒，格式化為 1:05
      expect(quiz.formattedTime.value).toBe('1:05')
    })
  })

  describe('統計功能測試', () => {
    beforeEach(() => {
      quiz = useQuiz(mockQuestions)
      quiz.initializeQuiz()
      quiz.startQuiz()
    })

    it('應該正確更新統計資料', () => {
      quiz.answerQuestion('A') // 正確答案
      quiz.answerQuestion('B') // 錯誤答案（第二題正確答案是C）
      
      expect(quiz.statistics.totalQuestionsAnswered).toBe(2)
      expect(quiz.statistics.correctAnswers).toBe(1)
      expect(quiz.statistics.incorrectAnswers).toBe(1)
      expect(quiz.statistics.accuracyPercentage).toBe(50)
    })

    it('應該追蹤連續正確答案', () => {
      quiz.answerQuestion('A') // 正確
      expect(quiz.statistics.streakCorrect).toBe(1)
      
      vi.advanceTimersByTime(1000)
      quiz.answerQuestion('C') // 正確（第二題）
      expect(quiz.statistics.streakCorrect).toBe(2)
      expect(quiz.statistics.maxStreakCorrect).toBe(2)
      
      vi.advanceTimersByTime(1000)
      quiz.answerQuestion('A') // 錯誤（第三題正確答案是B）
      expect(quiz.statistics.streakCorrect).toBe(0)
      expect(quiz.statistics.maxStreakCorrect).toBe(2) // 保持最大值
    })
  })

  describe('資料持久化測試', () => {
    it('應該能保存狀態到 localStorage', () => {
      quiz = useQuiz(mockQuestions)
      quiz.initializeQuiz()
      quiz.startQuiz()
      quiz.answerQuestion('A')
      
      // 等待自動前進
      vi.advanceTimersByTime(1000)
      
      quiz.saveToStorage()
      
      const savedStateStr = localStorage.getItem('ipas-quiz-state')
      expect(savedStateStr).toBeTruthy()
      
      if (savedStateStr) {
        const savedState = JSON.parse(savedStateStr)
        expect(savedState.currentQuestionIndex).toBe(1) // 回答後自動前進
        expect(savedState.isQuizStarted).toBe(true)
      }
    })

    it('應該能從 localStorage 載入狀態', () => {
      // 模擬已保存的狀態
      const mockState = {
        currentQuestionIndex: 1,
        isQuizStarted: true,
        isQuizCompleted: false,
        totalQuizTime: 30,
        questions: mockQuestions
      }
      localStorage.setItem('ipas-quiz-state', JSON.stringify(mockState))
      
      quiz = useQuiz(mockQuestions)
      quiz.loadFromStorage()
      
      expect(quiz.currentQuestionIndex.value).toBe(1)
      expect(quiz.isQuizStarted.value).toBe(true)
    })

    it('載入無效資料時應該優雅處理', () => {
      localStorage.setItem('ipas-quiz-state', 'invalid json')
      
      quiz = useQuiz(mockQuestions)
      quiz.loadFromStorage() // 不應該拋出錯誤
      
      expect(quiz.currentQuestionIndex.value).toBe(0) // 使用預設值
    })
  })

  describe('測驗流程控制測試', () => {
    beforeEach(() => {
      quiz = useQuiz(singleQuestion)
      quiz.initializeQuiz()
    })

    it('應該能開始測驗', () => {
      expect(quiz.isQuizStarted.value).toBe(false)
      
      quiz.startQuiz()
      
      expect(quiz.isQuizStarted.value).toBe(true)
      expect(quiz.statistics.lastSessionDate).toBeTruthy()
    })

    it('應該能完成測驗', () => {
      quiz.startQuiz()
      quiz.answerQuestion('A')
      
      vi.advanceTimersByTime(1000)
      
      expect(quiz.isQuizCompleted.value).toBe(true)
    })

    it('應該能重置測驗', () => {
      quiz.startQuiz()
      quiz.answerQuestion('A')
      
      quiz.resetQuiz()
      
      expect(quiz.currentQuestionIndex.value).toBe(0)
      expect(quiz.isQuizStarted.value).toBe(false)
      expect(quiz.isQuizCompleted.value).toBe(false)
      expect(quiz.userAnswers.size).toBe(0)
      expect(quiz.score.value.correct).toBe(0)
    })

    it('應該能進入檢視模式', () => {
      quiz.startQuiz()
      quiz.answerQuestion('A')
      quiz.completeQuiz()
      
      quiz.enterReviewMode()
      
      expect(quiz.isReviewMode.value).toBe(true)
      expect(quiz.statistics.questionsReviewed).toBe(1)
    })

    it('應該能退出檢視模式', () => {
      quiz.enterReviewMode()
      
      quiz.exitReviewMode()
      
      expect(quiz.isReviewMode.value).toBe(false)
    })
  })

  describe('題目配置測試', () => {
    it('應該能打亂題目順序', () => {
      quiz = useQuiz(mockQuestions)
      quiz.initializeQuiz({ shuffleQuestions: true })
      
      // 由於隨機性，我們檢查題目總數是否正確
      expect(quiz.questions.value).toHaveLength(mockQuestions.length)
      expect(quiz.questions.value.every(q => 
        mockQuestions.some(mq => mq.id === q.id)
      )).toBe(true)
    })

    it('應該能打亂選項順序', () => {
      quiz = useQuiz(mockQuestions)
      quiz.initializeQuiz({ shuffleOptions: true })
      
      const question = quiz.currentQuestion.value
      expect(question.options).toBeDefined()
      expect(Object.keys(question.options)).toHaveLength(4)
    })
  })

  describe('鍵盤操作測試', () => {
    beforeEach(() => {
      quiz = useQuiz(mockQuestions)
      quiz.initializeQuiz()
      quiz.startQuiz()
    })

    it('應該有鍵盤啟用配置', () => {
      expect(quiz.keyboardEnabled.value).toBe(true)
      
      quiz.keyboardEnabled.value = false
      expect(quiz.keyboardEnabled.value).toBe(false)
    })

    it('鍵盤狀態應該可以切換', () => {
      const initialState = quiz.keyboardEnabled.value
      
      quiz.keyboardEnabled.value = !initialState
      expect(quiz.keyboardEnabled.value).toBe(!initialState)
    })
  })

  describe('結果分析測試', () => {
    beforeEach(() => {
      quiz = useQuiz(mockQuestions)
      quiz.initializeQuiz()
      quiz.startQuiz()
    })

    it('應該能取得詳細結果', () => {
      quiz.answerQuestion('A') // 正確
      vi.advanceTimersByTime(1000)
      quiz.answerQuestion('B') // 錯誤
      vi.advanceTimersByTime(1000)
      quiz.answerQuestion('B') // 正確
      
      const results = quiz.getResults()
      
      expect(results.questions).toHaveLength(3)
      expect(results.score.correct).toBe(2)
      expect(results.score.total).toBe(3)
      expect(results.statistics).toBeDefined()
    })

    it('應該能取得題目狀態', () => {
      quiz.answerQuestion('A')
      
      const status = quiz.getQuestionStatus(mockQuestions[0].id)
      
      expect(status.answered).toBe(true)
      expect(status.correct).toBe(true)
      expect(status.selectedAnswer).toBe('A')
      expect(status.correctAnswer).toBe('A')
    })

    it('未回答題目的狀態應該正確', () => {
      const status = quiz.getQuestionStatus(mockQuestions[1].id)
      
      expect(status.answered).toBe(false)
      expect(status.correct).toBe(null)
    })
  })
})