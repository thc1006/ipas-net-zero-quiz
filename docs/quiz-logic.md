# Quiz Logic Documentation

## Table of Contents

1. [Overview](#overview)
2. [Core Quiz Flow](#core-quiz-flow)
3. [Scoring Algorithm](#scoring-algorithm)
4. [Answer Validation](#answer-validation)
5. [Progress Tracking](#progress-tracking)
6. [Timer Management](#timer-management)
7. [State Persistence](#state-persistence)
8. [Navigation Logic](#navigation-logic)
9. [Result Calculation](#result-calculation)
10. [Advanced Features](#advanced-features)

---

## Overview

The quiz logic in the iPAS Net Zero Quiz Application is designed to provide a seamless, educational experience with immediate feedback, comprehensive tracking, and flexible configuration options. This document details the underlying algorithms and decision trees that power the quiz functionality.

### Core Principles

1. **Immediate Feedback**: Users receive instant validation of their answers
2. **Progress Persistence**: Quiz state is preserved across sessions
3. **Flexible Navigation**: Support for linear and non-linear progression
4. **Comprehensive Tracking**: Detailed metrics for learning analytics
5. **Configurable Behavior**: Adaptable to different quiz requirements

---

## Core Quiz Flow

### Quiz Lifecycle State Machine

```
┌──────────┐
│   INIT   │
└────┬─────┘
     │ loadQuestions()
     ↓
┌──────────┐
│  READY   │
└────┬─────┘
     │ startQuiz()
     ↓
┌──────────┐        answerQuestion()      ┌──────────┐
│  ACTIVE  │ ←──────────────────────────→ │ ANSWERED │
└────┬─────┘                              └────┬─────┘
     │                                          │
     │ completeQuiz()                          │ nextQuestion()
     ↓                                          ↓
┌──────────┐                              ┌──────────┐
│ COMPLETE │                              │   NEXT   │
└────┬─────┘                              └──────────┘
     │ enterReview()
     ↓
┌──────────┐
│  REVIEW  │
└──────────┘
```

### Detailed Flow Algorithm

```javascript
class QuizFlow {
  constructor() {
    this.state = 'INIT'
    this.currentQuestionIndex = 0
    this.answers = new Map()
    this.startTime = null
    this.endTime = null
  }

  async initialize() {
    // Load questions from JSON
    this.questions = await this.loadQuestions()
    
    // Apply configuration
    if (this.config.shuffleQuestions) {
      this.shuffleQuestions()
    }
    
    // Load saved state if exists
    this.loadSavedState()
    
    // Transition to READY
    this.state = 'READY'
  }

  startQuiz() {
    if (this.state !== 'READY') {
      throw new Error('Quiz must be in READY state to start')
    }
    
    this.state = 'ACTIVE'
    this.startTime = Date.now()
    this.recordQuestionStartTime()
    
    if (this.config.timerEnabled) {
      this.startTimer()
    }
  }

  answerQuestion(selectedOption) {
    if (this.state !== 'ACTIVE') {
      throw new Error('Quiz must be ACTIVE to answer questions')
    }
    
    // Validate answer
    const isValid = this.validateAnswer(selectedOption)
    if (!isValid) return false
    
    // Record answer
    const question = this.getCurrentQuestion()
    this.answers.set(question.id, {
      selected: selectedOption,
      correct: selectedOption === question.answer,
      timestamp: Date.now(),
      timeSpent: this.calculateTimeSpent()
    })
    
    // Update state
    this.state = 'ANSWERED'
    
    // Save progress
    this.saveState()
    
    // Auto-advance if configured
    if (this.config.autoAdvance) {
      setTimeout(() => this.nextQuestion(), this.config.advanceDelay)
    }
    
    return true
  }

  nextQuestion() {
    if (this.currentQuestionIndex < this.questions.length - 1) {
      this.currentQuestionIndex++
      this.state = 'ACTIVE'
      this.recordQuestionStartTime()
      
      if (this.config.timerEnabled) {
        this.resetTimer()
      }
    } else {
      this.completeQuiz()
    }
  }

  completeQuiz() {
    this.state = 'COMPLETE'
    this.endTime = Date.now()
    this.stopTimer()
    this.calculateResults()
    this.saveResults()
  }
}
```

---

## Scoring Algorithm

### Basic Scoring

The fundamental scoring algorithm calculates the percentage of correct answers:

```javascript
function calculateBasicScore(answers, questions) {
  let correct = 0
  let total = questions.length
  
  questions.forEach(question => {
    const answer = answers.get(question.id)
    if (answer && answer.selected === question.answer) {
      correct++
    }
  })
  
  return {
    correct,
    incorrect: total - correct,
    total,
    percentage: Math.round((correct / total) * 100)
  }
}
```

### Weighted Scoring

For questions with different importance levels:

```javascript
function calculateWeightedScore(answers, questions) {
  let totalWeight = 0
  let earnedWeight = 0
  
  questions.forEach(question => {
    const weight = question.weight || 1
    totalWeight += weight
    
    const answer = answers.get(question.id)
    if (answer && answer.selected === question.answer) {
      earnedWeight += weight
    }
  })
  
  return {
    earnedWeight,
    totalWeight,
    percentage: Math.round((earnedWeight / totalWeight) * 100)
  }
}
```

### Point-Based Scoring

For quizzes with variable point values:

```javascript
function calculatePointScore(answers, questions) {
  let totalPoints = 0
  let earnedPoints = 0
  
  questions.forEach(question => {
    const points = question.points || 1
    totalPoints += points
    
    const answer = answers.get(question.id)
    if (answer && answer.selected === question.answer) {
      earnedPoints += points
    }
  })
  
  return {
    earnedPoints,
    totalPoints,
    percentage: Math.round((earnedPoints / totalPoints) * 100)
  }
}
```

### Penalty Scoring

Incorporating penalties for wrong answers or time:

```javascript
function calculatePenaltyScore(answers, questions, config) {
  let score = 0
  const basePoints = config.basePoints || 100
  
  questions.forEach(question => {
    const answer = answers.get(question.id)
    
    if (!answer) {
      // No answer penalty
      score -= config.noAnswerPenalty || 0
    } else if (answer.selected === question.answer) {
      // Correct answer
      score += question.points || 1
      
      // Time bonus
      if (answer.timeSpent < config.bonusTimeThreshold) {
        score += config.timeBonus || 0
      }
    } else {
      // Wrong answer penalty
      score -= config.wrongAnswerPenalty || 0
    }
  })
  
  // Ensure score doesn't go below zero
  score = Math.max(0, score)
  
  return {
    score,
    maxScore: basePoints,
    percentage: Math.round((score / basePoints) * 100)
  }
}
```

### Adaptive Scoring

Adjusting score based on difficulty:

```javascript
function calculateAdaptiveScore(answers, questions) {
  const difficultyMultipliers = {
    easy: 1,
    medium: 1.5,
    hard: 2,
    expert: 3
  }
  
  let totalPossible = 0
  let earned = 0
  
  questions.forEach(question => {
    const difficulty = question.difficulty || 'medium'
    const multiplier = difficultyMultipliers[difficulty]
    const baseValue = question.points || 1
    const questionValue = baseValue * multiplier
    
    totalPossible += questionValue
    
    const answer = answers.get(question.id)
    if (answer && answer.selected === question.answer) {
      earned += questionValue
    }
  })
  
  return {
    earned,
    totalPossible,
    percentage: Math.round((earned / totalPossible) * 100),
    difficulty_adjusted: true
  }
}
```

---

## Answer Validation

### Input Validation

```javascript
function validateAnswerInput(selectedOption, question) {
  // Check if answer is provided
  if (!selectedOption) {
    return {
      valid: false,
      error: 'No answer selected'
    }
  }
  
  // Check if answer is a valid option
  const validOptions = Object.keys(question.options)
  if (!validOptions.includes(selectedOption)) {
    return {
      valid: false,
      error: 'Invalid option selected'
    }
  }
  
  // Check if question has already been answered (if not allowed)
  if (this.config.preventReAnswer && this.answers.has(question.id)) {
    return {
      valid: false,
      error: 'Question already answered'
    }
  }
  
  // Check time limit
  if (this.config.enforceTimeLimit) {
    const timeSpent = Date.now() - this.questionStartTime
    if (timeSpent > question.timeLimit * 1000) {
      return {
        valid: false,
        error: 'Time limit exceeded'
      }
    }
  }
  
  return { valid: true }
}
```

### Answer Processing

```javascript
function processAnswer(selectedOption, question) {
  // Validate input
  const validation = validateAnswerInput(selectedOption, question)
  if (!validation.valid) {
    return { success: false, error: validation.error }
  }
  
  // Check correctness
  const isCorrect = selectedOption === question.answer
  
  // Calculate score contribution
  const scoreContribution = calculateScoreContribution(question, isCorrect)
  
  // Record detailed answer data
  const answerData = {
    questionId: question.id,
    selected: selectedOption,
    correct: question.answer,
    isCorrect,
    timestamp: Date.now(),
    timeSpent: this.calculateTimeSpent(),
    scoreContribution,
    attempts: this.getAttemptCount(question.id) + 1
  }
  
  // Store answer
  this.answers.set(question.id, answerData)
  
  // Update statistics
  this.updateStatistics(answerData)
  
  // Trigger events
  this.emit('answerProcessed', answerData)
  
  return {
    success: true,
    isCorrect,
    feedback: this.generateFeedback(question, isCorrect)
  }
}
```

### Answer Verification

```javascript
function verifyAnswer(answer, question) {
  // Type checking
  if (typeof answer !== 'string') {
    throw new TypeError('Answer must be a string')
  }
  
  // Format validation
  const answerFormat = /^[A-F]$/
  if (!answerFormat.test(answer)) {
    throw new Error('Answer must be A-F')
  }
  
  // Option existence check
  if (!question.options[answer]) {
    throw new Error(`Option ${answer} does not exist for this question`)
  }
  
  // Correctness check
  return answer === question.answer
}
```

---

## Progress Tracking

### Progress Calculation

```javascript
class ProgressTracker {
  constructor(totalQuestions) {
    this.totalQuestions = totalQuestions
    this.answeredQuestions = 0
    this.correctAnswers = 0
    this.currentStreak = 0
    this.maxStreak = 0
    this.categoryProgress = new Map()
  }
  
  updateProgress(answerData) {
    // Update answered count
    this.answeredQuestions++
    
    // Update correct count
    if (answerData.isCorrect) {
      this.correctAnswers++
      this.currentStreak++
      this.maxStreak = Math.max(this.maxStreak, this.currentStreak)
    } else {
      this.currentStreak = 0
    }
    
    // Update category progress
    const category = answerData.question.category || 'general'
    if (!this.categoryProgress.has(category)) {
      this.categoryProgress.set(category, {
        total: 0,
        correct: 0
      })
    }
    
    const catProgress = this.categoryProgress.get(category)
    catProgress.total++
    if (answerData.isCorrect) {
      catProgress.correct++
    }
  }
  
  getProgress() {
    return {
      // Overall progress
      percentage: Math.round((this.answeredQuestions / this.totalQuestions) * 100),
      answeredQuestions: this.answeredQuestions,
      remainingQuestions: this.totalQuestions - this.answeredQuestions,
      
      // Performance metrics
      correctAnswers: this.correctAnswers,
      incorrectAnswers: this.answeredQuestions - this.correctAnswers,
      accuracy: this.answeredQuestions > 0 
        ? Math.round((this.correctAnswers / this.answeredQuestions) * 100)
        : 0,
      
      // Streaks
      currentStreak: this.currentStreak,
      maxStreak: this.maxStreak,
      
      // Category breakdown
      categoryBreakdown: Array.from(this.categoryProgress.entries()).map(([cat, data]) => ({
        category: cat,
        total: data.total,
        correct: data.correct,
        percentage: Math.round((data.correct / data.total) * 100)
      }))
    }
  }
  
  getEstimatedScore() {
    // Estimate final score based on current performance
    const currentAccuracy = this.correctAnswers / this.answeredQuestions
    const estimatedCorrect = Math.round(currentAccuracy * this.totalQuestions)
    
    return {
      estimated: Math.round((estimatedCorrect / this.totalQuestions) * 100),
      confidence: this.answeredQuestions / this.totalQuestions, // 0-1
      basedOn: this.answeredQuestions
    }
  }
}
```

### Progress Visualization Data

```javascript
function generateProgressVisualization(progress) {
  return {
    // Linear progress
    linear: {
      current: progress.answeredQuestions,
      total: progress.totalQuestions,
      percentage: progress.percentage
    },
    
    // Circular progress
    circular: {
      degrees: (progress.percentage / 100) * 360,
      strokeDasharray: `${progress.percentage}, 100`,
      color: getProgressColor(progress.percentage)
    },
    
    // Segmented progress
    segmented: {
      segments: progress.totalQuestions,
      completed: progress.answeredQuestions,
      correct: progress.correctAnswers,
      incorrect: progress.incorrectAnswers
    },
    
    // Category radar chart data
    radar: {
      categories: progress.categoryBreakdown.map(c => c.category),
      values: progress.categoryBreakdown.map(c => c.percentage)
    }
  }
}

function getProgressColor(percentage) {
  if (percentage < 25) return '#ef4444'  // Red
  if (percentage < 50) return '#f59e0b'  // Amber
  if (percentage < 75) return '#3b82f6'  // Blue
  return '#10b981'  // Green
}
```

---

## Timer Management

### Timer Implementation

```javascript
class QuizTimer {
  constructor(config = {}) {
    this.timePerQuestion = config.timePerQuestion || 60
    this.totalTimeLimit = config.totalTimeLimit || null
    this.warningThreshold = config.warningThreshold || 10
    this.currentQuestionTime = 0
    this.totalElapsedTime = 0
    this.timerInterval = null
    this.callbacks = new Map()
  }
  
  startQuestionTimer() {
    this.stopTimer() // Clear any existing timer
    this.currentQuestionTime = 0
    
    this.timerInterval = setInterval(() => {
      this.currentQuestionTime++
      this.totalElapsedTime++
      
      // Check question time limit
      if (this.currentQuestionTime >= this.timePerQuestion) {
        this.onQuestionTimeExpired()
      }
      
      // Check warning threshold
      const remaining = this.timePerQuestion - this.currentQuestionTime
      if (remaining === this.warningThreshold) {
        this.onWarningThreshold()
      }
      
      // Check total time limit
      if (this.totalTimeLimit && this.totalElapsedTime >= this.totalTimeLimit) {
        this.onTotalTimeExpired()
      }
      
      // Update callbacks
      this.triggerCallbacks('tick', {
        currentQuestionTime: this.currentQuestionTime,
        totalElapsedTime: this.totalElapsedTime,
        remaining
      })
    }, 1000)
  }
  
  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval)
      this.timerInterval = null
    }
  }
  
  pauseTimer() {
    this.stopTimer()
    this.isPaused = true
  }
  
  resumeTimer() {
    if (this.isPaused) {
      this.startQuestionTimer()
      this.isPaused = false
    }
  }
  
  resetQuestionTimer() {
    this.currentQuestionTime = 0
    if (this.timerInterval) {
      this.startQuestionTimer()
    }
  }
  
  getFormattedTime(seconds) {
    const minutes = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${minutes}:${secs.toString().padStart(2, '0')}`
  }
  
  getRemainingTime() {
    return Math.max(0, this.timePerQuestion - this.currentQuestionTime)
  }
  
  getTimeStats() {
    return {
      currentQuestion: {
        elapsed: this.currentQuestionTime,
        remaining: this.getRemainingTime(),
        formatted: this.getFormattedTime(this.currentQuestionTime)
      },
      total: {
        elapsed: this.totalElapsedTime,
        formatted: this.getFormattedTime(this.totalElapsedTime),
        average: this.getAverageTimePerQuestion()
      }
    }
  }
  
  onQuestionTimeExpired() {
    this.stopTimer()
    this.triggerCallbacks('questionExpired')
  }
  
  onWarningThreshold() {
    this.triggerCallbacks('warning')
  }
  
  onTotalTimeExpired() {
    this.stopTimer()
    this.triggerCallbacks('totalExpired')
  }
  
  on(event, callback) {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, [])
    }
    this.callbacks.get(event).push(callback)
  }
  
  triggerCallbacks(event, data) {
    const callbacks = this.callbacks.get(event) || []
    callbacks.forEach(cb => cb(data))
  }
}
```

### Time-Based Scoring

```javascript
function calculateTimeBonus(timeSpent, timeLimit) {
  // No bonus if over time limit
  if (timeSpent >= timeLimit) {
    return 0
  }
  
  // Calculate bonus based on speed
  const timeRatio = timeSpent / timeLimit
  
  if (timeRatio < 0.25) {
    return 10 // Very fast - 10 point bonus
  } else if (timeRatio < 0.5) {
    return 5  // Fast - 5 point bonus
  } else if (timeRatio < 0.75) {
    return 2  // Moderate - 2 point bonus
  } else {
    return 0  // No bonus
  }
}
```

---

## State Persistence

### LocalStorage Schema

```javascript
const STORAGE_SCHEMA = {
  // Current quiz state
  'quiz-state': {
    version: '1.0.0',
    currentQuestionIndex: 0,
    startTime: null,
    isPaused: false,
    isCompleted: false
  },
  
  // User answers
  'quiz-answers': [
    {
      questionId: 'q1',
      selected: 'A',
      correct: 'B',
      isCorrect: false,
      timestamp: 1234567890,
      timeSpent: 45
    }
  ],
  
  // Quiz configuration
  'quiz-config': {
    shuffleQuestions: false,
    shuffleOptions: false,
    timePerQuestion: 60,
    autoAdvance: true
  },
  
  // Performance statistics
  'quiz-stats': {
    totalAttempts: 5,
    bestScore: 85,
    averageScore: 72,
    totalTimeSpent: 3600,
    lastAttempt: '2025-08-21T10:00:00Z'
  }
}
```

### State Saving

```javascript
class StatePersistence {
  constructor(storagePrefix = 'quiz') {
    this.prefix = storagePrefix
    this.storage = window.localStorage
  }
  
  saveState(state) {
    try {
      // Serialize state
      const serialized = this.serializeState(state)
      
      // Compress if needed
      const compressed = this.shouldCompress(serialized) 
        ? this.compress(serialized)
        : serialized
      
      // Save to storage
      this.storage.setItem(
        `${this.prefix}-state`,
        JSON.stringify(compressed)
      )
      
      // Save timestamp
      this.storage.setItem(
        `${this.prefix}-saved-at`,
        new Date().toISOString()
      )
      
      return true
    } catch (error) {
      console.error('Failed to save state:', error)
      
      // Handle quota exceeded
      if (error.name === 'QuotaExceededError') {
        this.clearOldData()
        return this.saveState(state) // Retry
      }
      
      return false
    }
  }
  
  loadState() {
    try {
      const compressed = this.storage.getItem(`${this.prefix}-state`)
      if (!compressed) return null
      
      // Parse stored data
      const parsed = JSON.parse(compressed)
      
      // Decompress if needed
      const decompressed = this.isCompressed(parsed)
        ? this.decompress(parsed)
        : parsed
      
      // Deserialize state
      return this.deserializeState(decompressed)
    } catch (error) {
      console.error('Failed to load state:', error)
      return null
    }
  }
  
  serializeState(state) {
    return {
      version: '1.0.0',
      timestamp: Date.now(),
      data: {
        currentQuestionIndex: state.currentQuestionIndex,
        answers: Array.from(state.answers.entries()),
        startTime: state.startTime,
        config: state.config,
        progress: state.progress
      }
    }
  }
  
  deserializeState(serialized) {
    // Version compatibility check
    if (serialized.version !== '1.0.0') {
      return this.migrateState(serialized)
    }
    
    return {
      currentQuestionIndex: serialized.data.currentQuestionIndex,
      answers: new Map(serialized.data.answers),
      startTime: serialized.data.startTime,
      config: serialized.data.config,
      progress: serialized.data.progress
    }
  }
  
  clearState() {
    const keys = Object.keys(this.storage).filter(key => 
      key.startsWith(this.prefix)
    )
    keys.forEach(key => this.storage.removeItem(key))
  }
}
```

### Session Recovery

```javascript
function recoverSession() {
  const persistence = new StatePersistence()
  const savedState = persistence.loadState()
  
  if (!savedState) {
    return { recovered: false }
  }
  
  // Check if session is valid
  const savedAt = localStorage.getItem('quiz-saved-at')
  const hoursSinceSave = (Date.now() - new Date(savedAt)) / 3600000
  
  if (hoursSinceSave > 24) {
    // Session too old
    persistence.clearState()
    return { recovered: false, reason: 'Session expired' }
  }
  
  // Restore state
  return {
    recovered: true,
    state: savedState,
    resumeFrom: savedState.currentQuestionIndex,
    answers: savedState.answers.size,
    timeElapsed: savedState.timeElapsed
  }
}
```

---

## Navigation Logic

### Linear Navigation

```javascript
class LinearNavigation {
  constructor(totalQuestions) {
    this.totalQuestions = totalQuestions
    this.currentIndex = 0
    this.visitedQuestions = new Set()
  }
  
  canGoNext() {
    return this.currentIndex < this.totalQuestions - 1
  }
  
  canGoPrevious() {
    return this.currentIndex > 0
  }
  
  next() {
    if (!this.canGoNext()) {
      throw new Error('Cannot go to next question')
    }
    this.currentIndex++
    this.visitedQuestions.add(this.currentIndex)
    return this.currentIndex
  }
  
  previous() {
    if (!this.canGoPrevious()) {
      throw new Error('Cannot go to previous question')
    }
    this.currentIndex--
    return this.currentIndex
  }
  
  jumpTo(index) {
    if (index < 0 || index >= this.totalQuestions) {
      throw new Error('Invalid question index')
    }
    this.currentIndex = index
    this.visitedQuestions.add(index)
    return this.currentIndex
  }
  
  getNavigationState() {
    return {
      current: this.currentIndex,
      total: this.totalQuestions,
      canGoNext: this.canGoNext(),
      canGoPrevious: this.canGoPrevious(),
      visited: Array.from(this.visitedQuestions),
      unvisited: this.getUnvisitedQuestions()
    }
  }
  
  getUnvisitedQuestions() {
    const unvisited = []
    for (let i = 0; i < this.totalQuestions; i++) {
      if (!this.visitedQuestions.has(i)) {
        unvisited.push(i)
      }
    }
    return unvisited
  }
}
```

### Non-Linear Navigation

```javascript
class NonLinearNavigation extends LinearNavigation {
  constructor(totalQuestions, allowedPaths) {
    super(totalQuestions)
    this.allowedPaths = allowedPaths || this.generateFullGraph()
    this.navigationHistory = []
  }
  
  generateFullGraph() {
    // Allow navigation to any question
    const graph = {}
    for (let i = 0; i < this.totalQuestions; i++) {
      graph[i] = []
      for (let j = 0; j < this.totalQuestions; j++) {
        if (i !== j) {
          graph[i].push(j)
        }
      }
    }
    return graph
  }
  
  canNavigateTo(targetIndex) {
    const allowedFromCurrent = this.allowedPaths[this.currentIndex] || []
    return allowedFromCurrent.includes(targetIndex)
  }
  
  navigateTo(targetIndex) {
    if (!this.canNavigateTo(targetIndex)) {
      throw new Error(`Cannot navigate from ${this.currentIndex} to ${targetIndex}`)
    }
    
    this.navigationHistory.push(this.currentIndex)
    this.currentIndex = targetIndex
    this.visitedQuestions.add(targetIndex)
    
    return this.currentIndex
  }
  
  getAvailableDestinations() {
    return this.allowedPaths[this.currentIndex] || []
  }
  
  getNavigationMap() {
    const map = []
    for (let i = 0; i < this.totalQuestions; i++) {
      map.push({
        index: i,
        visited: this.visitedQuestions.has(i),
        current: i === this.currentIndex,
        accessible: this.canNavigateTo(i)
      })
    }
    return map
  }
}
```

### Adaptive Navigation

```javascript
class AdaptiveNavigation {
  constructor(questions, userProfile) {
    this.questions = questions
    this.userProfile = userProfile
    this.performanceHistory = []
  }
  
  getNextQuestion() {
    const performance = this.calculatePerformance()
    
    // Adaptive difficulty selection
    let targetDifficulty
    if (performance.accuracy > 0.8) {
      targetDifficulty = 'hard'
    } else if (performance.accuracy > 0.6) {
      targetDifficulty = 'medium'
    } else {
      targetDifficulty = 'easy'
    }
    
    // Find suitable questions
    const candidates = this.questions.filter(q => 
      !this.isAnswered(q.id) && 
      q.difficulty === targetDifficulty
    )
    
    // Fallback to any unanswered question
    if (candidates.length === 0) {
      candidates.push(...this.questions.filter(q => !this.isAnswered(q.id)))
    }
    
    // Select based on category preference
    return this.selectByPreference(candidates)
  }
  
  calculatePerformance() {
    if (this.performanceHistory.length === 0) {
      return { accuracy: 0.5 } // Default medium difficulty
    }
    
    const recent = this.performanceHistory.slice(-5) // Last 5 questions
    const correct = recent.filter(p => p.correct).length
    
    return {
      accuracy: correct / recent.length,
      trend: this.calculateTrend(recent)
    }
  }
  
  selectByPreference(candidates) {
    // Prioritize weak categories
    const weakCategories = this.identifyWeakCategories()
    
    const prioritized = candidates.filter(q => 
      weakCategories.includes(q.category)
    )
    
    if (prioritized.length > 0) {
      return prioritized[0]
    }
    
    // Random selection from candidates
    return candidates[Math.floor(Math.random() * candidates.length)]
  }
}
```

---

## Result Calculation

### Comprehensive Results

```javascript
class ResultCalculator {
  constructor(questions, answers, config) {
    this.questions = questions
    this.answers = answers
    this.config = config
  }
  
  calculateResults() {
    const basicScore = this.calculateBasicScore()
    const categoryScores = this.calculateCategoryScores()
    const timeAnalysis = this.analyzeTimePerformance()
    const difficultyAnalysis = this.analyzeDifficultyPerformance()
    const recommendations = this.generateRecommendations()
    
    return {
      // Overall score
      score: {
        percentage: basicScore.percentage,
        correct: basicScore.correct,
        incorrect: basicScore.incorrect,
        total: basicScore.total,
        grade: this.calculateGrade(basicScore.percentage)
      },
      
      // Detailed breakdown
      breakdown: {
        byCategory: categoryScores,
        byDifficulty: difficultyAnalysis,
        byTime: timeAnalysis
      },
      
      // Performance metrics
      metrics: {
        averageTimePerQuestion: timeAnalysis.average,
        fastestAnswer: timeAnalysis.fastest,
        slowestAnswer: timeAnalysis.slowest,
        accuracy: basicScore.percentage,
        consistency: this.calculateConsistency(),
        improvement: this.calculateImprovement()
      },
      
      // Certification status
      certification: {
        passed: basicScore.percentage >= 70,
        score: basicScore.percentage,
        requiredScore: 70,
        certificate: this.generateCertificate(basicScore.percentage)
      },
      
      // Learning insights
      insights: {
        strengths: this.identifyStrengths(categoryScores),
        weaknesses: this.identifyWeaknesses(categoryScores),
        recommendations: recommendations
      }
    }
  }
  
  calculateBasicScore() {
    let correct = 0
    
    this.questions.forEach(question => {
      const answer = this.answers.get(question.id)
      if (answer && answer.selected === question.answer) {
        correct++
      }
    })
    
    return {
      correct,
      incorrect: this.questions.length - correct,
      total: this.questions.length,
      percentage: Math.round((correct / this.questions.length) * 100)
    }
  }
  
  calculateCategoryScores() {
    const categories = new Map()
    
    this.questions.forEach(question => {
      const category = question.category || 'General'
      
      if (!categories.has(category)) {
        categories.set(category, {
          total: 0,
          correct: 0,
          questions: []
        })
      }
      
      const catData = categories.get(category)
      catData.total++
      catData.questions.push(question.id)
      
      const answer = this.answers.get(question.id)
      if (answer && answer.selected === question.answer) {
        catData.correct++
      }
    })
    
    return Array.from(categories.entries()).map(([category, data]) => ({
      category,
      total: data.total,
      correct: data.correct,
      percentage: Math.round((data.correct / data.total) * 100),
      questions: data.questions
    }))
  }
  
  analyzeTimePerformance() {
    const times = []
    let totalTime = 0
    
    this.answers.forEach(answer => {
      if (answer.timeSpent) {
        times.push(answer.timeSpent)
        totalTime += answer.timeSpent
      }
    })
    
    if (times.length === 0) {
      return { average: 0, fastest: 0, slowest: 0 }
    }
    
    return {
      average: Math.round(totalTime / times.length),
      fastest: Math.min(...times),
      slowest: Math.max(...times),
      total: totalTime,
      distribution: this.getTimeDistribution(times)
    }
  }
  
  calculateGrade(percentage) {
    if (percentage >= 90) return 'A+'
    if (percentage >= 85) return 'A'
    if (percentage >= 80) return 'A-'
    if (percentage >= 75) return 'B+'
    if (percentage >= 70) return 'B'
    if (percentage >= 65) return 'B-'
    if (percentage >= 60) return 'C'
    if (percentage >= 50) return 'D'
    return 'F'
  }
  
  generateRecommendations() {
    const recommendations = []
    const categoryScores = this.calculateCategoryScores()
    
    // Identify weak areas
    categoryScores.forEach(category => {
      if (category.percentage < 60) {
        recommendations.push({
          type: 'study',
          priority: 'high',
          category: category.category,
          message: `Focus on ${category.category} - current score: ${category.percentage}%`
        })
      }
    })
    
    // Time management
    const timeAnalysis = this.analyzeTimePerformance()
    if (timeAnalysis.average > 90) {
      recommendations.push({
        type: 'practice',
        priority: 'medium',
        message: 'Practice to improve answer speed'
      })
    }
    
    return recommendations
  }
}
```

### Certificate Generation

```javascript
function generateCertificate(score, userName, quizTitle) {
  if (score < 70) {
    return null // No certificate for failing score
  }
  
  const certificateId = generateUniqueId()
  const issuedDate = new Date().toISOString()
  
  return {
    id: certificateId,
    recipient: userName,
    quiz: quizTitle,
    score: score,
    grade: calculateGrade(score),
    issuedDate: issuedDate,
    validUntil: calculateExpiryDate(issuedDate),
    verificationUrl: `/verify/${certificateId}`,
    digitalSignature: generateDigitalSignature({
      id: certificateId,
      recipient: userName,
      score,
      issuedDate
    })
  }
}
```

---

## Advanced Features

### Question Shuffling

```javascript
function shuffleQuestions(questions, seed = null) {
  // Use seeded random for reproducible shuffles
  const random = seed ? seedrandom(seed) : Math.random
  
  const shuffled = [...questions]
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  
  return shuffled
}

function shuffleOptions(question, seed = null) {
  const random = seed ? seedrandom(seed) : Math.random
  
  // Extract options
  const options = Object.entries(question.options)
  const correctAnswer = question.answer
  const correctOption = question.options[correctAnswer]
  
  // Shuffle option values
  const values = options.map(([, value]) => value)
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[values[i], values[j]] = [values[j], values[i]]
  }
  
  // Rebuild options object
  const shuffledOptions = {}
  const keys = ['A', 'B', 'C', 'D']
  let newCorrectAnswer = null
  
  keys.forEach((key, index) => {
    if (index < values.length) {
      shuffledOptions[key] = values[index]
      if (values[index] === correctOption) {
        newCorrectAnswer = key
      }
    }
  })
  
  return {
    ...question,
    options: shuffledOptions,
    answer: newCorrectAnswer
  }
}
```

### Partial Credit System

```javascript
function calculatePartialCredit(question, selectedAnswers) {
  // For multiple-select questions
  if (question.type === 'multiple-select') {
    const correct = new Set(question.correctAnswers)
    const selected = new Set(selectedAnswers)
    
    let points = 0
    const pointsPerCorrect = 1 / correct.size
    
    // Add points for correct selections
    selected.forEach(answer => {
      if (correct.has(answer)) {
        points += pointsPerCorrect
      } else {
        // Penalty for wrong selection
        points -= pointsPerCorrect * 0.5
      }
    })
    
    // Penalty for missed correct answers
    correct.forEach(answer => {
      if (!selected.has(answer)) {
        points -= pointsPerCorrect * 0.25
      }
    })
    
    return Math.max(0, Math.min(1, points))
  }
  
  return selectedAnswers === question.answer ? 1 : 0
}
```

### Hint System

```javascript
class HintSystem {
  constructor(config = {}) {
    this.maxHints = config.maxHints || 2
    this.hintPenalty = config.hintPenalty || 0.25
    this.hintsUsed = new Map()
  }
  
  getHint(question, level = 1) {
    const questionHints = this.hintsUsed.get(question.id) || []
    
    if (questionHints.length >= this.maxHints) {
      return { error: 'Maximum hints used for this question' }
    }
    
    const hint = this.generateHint(question, level)
    questionHints.push({
      level,
      hint,
      timestamp: Date.now()
    })
    
    this.hintsUsed.set(question.id, questionHints)
    
    return {
      hint,
      hintsRemaining: this.maxHints - questionHints.length,
      penalty: this.hintPenalty * questionHints.length
    }
  }
  
  generateHint(question, level) {
    switch (level) {
      case 1:
        // Eliminate wrong answers
        return this.eliminateWrongAnswers(question)
      case 2:
        // Provide context clue
        return this.provideContextClue(question)
      default:
        return 'No hint available'
    }
  }
  
  eliminateWrongAnswers(question) {
    const options = Object.keys(question.options)
    const correct = question.answer
    const wrong = options.filter(opt => opt !== correct)
    
    // Eliminate half of wrong answers
    const toEliminate = wrong.slice(0, Math.floor(wrong.length / 2))
    
    return {
      type: 'elimination',
      eliminated: toEliminate,
      message: `Options ${toEliminate.join(', ')} are incorrect`
    }
  }
  
  calculateScoreWithPenalty(baseScore, questionId) {
    const hints = this.hintsUsed.get(questionId) || []
    const penalty = hints.length * this.hintPenalty
    return Math.max(0, baseScore - penalty)
  }
}
```

---

*Last Updated: 2025-08-21*

*For quiz logic support, contact the development team.*