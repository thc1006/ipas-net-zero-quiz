import { ref, computed, reactive } from 'vue'
import type { QuizQuestion, QuizAnswer, QuizResults, QuizMode } from '../types/quiz'

export function useQuiz(questions: QuizQuestion[]) {
  // State
  const currentQuestionIndex = ref(0)
  const selectedAnswers = reactive<Map<string, QuizAnswer>>(new Map())
  const mode = ref<QuizMode>('quiz')
  const showExplanation = ref(false)
  const startTime = ref<Date | null>(null)
  const endTime = ref<Date | null>(null)

  // Computed properties
  const currentQuestion = computed(() => questions[currentQuestionIndex.value])
  
  const totalQuestions = computed(() => questions.length)
  
  const isFirstQuestion = computed(() => currentQuestionIndex.value === 0)
  
  const isLastQuestion = computed(() => currentQuestionIndex.value === questions.length - 1)
  
  const progress = computed(() => {
    if (questions.length === 0) return 0
    return Math.round(((currentQuestionIndex.value + 1) / questions.length) * 100)
  })
  
  const answeredQuestionsCount = computed(() => selectedAnswers.size)
  
  const currentAnswer = computed(() => {
    if (!currentQuestion.value) return null
    return selectedAnswers.get(currentQuestion.value.id) || null
  })

  const results = computed((): QuizResults => {
    const answers = Array.from(selectedAnswers.values())
    const correctAnswers = answers.filter(answer => answer.isCorrect).length
    const incorrectAnswers = answers.length - correctAnswers
    const score = questions.length > 0 ? Math.round((correctAnswers / questions.length) * 100) : 0

    // Calculate subject-wise results
    const subjects: Record<string, { correct: number; total: number }> = {}
    
    questions.forEach(question => {
      if (!subjects[question.subject]) {
        subjects[question.subject] = { correct: 0, total: 0 }
      }
      subjects[question.subject].total++
      
      const answer = selectedAnswers.get(question.id)
      if (answer && answer.isCorrect) {
        subjects[question.subject].correct++
      }
    })

    return {
      totalQuestions: questions.length,
      correctAnswers,
      incorrectAnswers,
      score,
      answers,
      subjects
    }
  })

  // Methods
  function startQuiz() {
    startTime.value = new Date()
    mode.value = 'quiz'
    currentQuestionIndex.value = 0
    selectedAnswers.clear()
    showExplanation.value = false
  }

  function selectAnswer(option: 'A' | 'B' | 'C' | 'D') {
    if (!currentQuestion.value || mode.value === 'results') return

    const questionStartTime = startTime.value || new Date()
    const timeSpent = new Date().getTime() - questionStartTime.getTime()

    const answer: QuizAnswer = {
      questionId: currentQuestion.value.id,
      selectedOption: option,
      isCorrect: option === currentQuestion.value.answer,
      timeSpent
    }

    selectedAnswers.set(currentQuestion.value.id, answer)

    if (mode.value === 'quiz') {
      showExplanation.value = true
    }
  }

  function nextQuestion() {
    if (isLastQuestion.value) {
      finishQuiz()
    } else {
      currentQuestionIndex.value++
      showExplanation.value = false
    }
  }

  function previousQuestion() {
    if (!isFirstQuestion.value) {
      currentQuestionIndex.value--
      showExplanation.value = false
    }
  }

  function goToQuestion(index: number) {
    if (index >= 0 && index < questions.length) {
      currentQuestionIndex.value = index
      showExplanation.value = false
    }
  }

  function finishQuiz() {
    endTime.value = new Date()
    mode.value = 'results'
    showExplanation.value = false
  }

  function reviewQuiz() {
    mode.value = 'review'
    currentQuestionIndex.value = 0
    showExplanation.value = true
  }

  function resetQuiz() {
    startQuiz()
  }

  function isQuestionAnswered(questionIndex: number): boolean {
    const question = questions[questionIndex]
    return question ? selectedAnswers.has(question.id) : false
  }

  function isQuestionCorrect(questionIndex: number): boolean {
    const question = questions[questionIndex]
    if (!question) return false
    const answer = selectedAnswers.get(question.id)
    return answer ? answer.isCorrect : false
  }

  return {
    // State
    currentQuestionIndex,
    mode,
    showExplanation,
    startTime,
    endTime,

    // Computed
    currentQuestion,
    totalQuestions,
    isFirstQuestion,
    isLastQuestion,
    progress,
    answeredQuestionsCount,
    currentAnswer,
    results,

    // Methods
    startQuiz,
    selectAnswer,
    nextQuestion,
    previousQuestion,
    goToQuestion,
    finishQuiz,
    reviewQuiz,
    resetQuiz,
    isQuestionAnswered,
    isQuestionCorrect
  }
}