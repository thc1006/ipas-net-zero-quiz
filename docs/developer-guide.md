# Developer Onboarding Guide

## Welcome to iPAS Net Zero Quiz Development

This comprehensive guide will help you get started with developing and maintaining the iPAS Net Zero Quiz Application. Whether you're a new team member or an experienced developer looking to contribute, this guide provides everything you need to know.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Development Environment Setup](#development-environment-setup)
3. [Project Structure](#project-structure)
4. [Development Workflow](#development-workflow)
5. [Code Standards](#code-standards)
6. [Component Development](#component-development)
7. [State Management](#state-management)
8. [Testing](#testing)
9. [Debugging](#debugging)
10. [Best Practices](#best-practices)
11. [Common Tasks](#common-tasks)
12. [Troubleshooting](#troubleshooting)

---

## Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:

| Tool | Minimum Version | Recommended Version | Purpose |
|------|----------------|-------------------|---------|
| Node.js | 18.0.0 | 20.x LTS | JavaScript runtime |
| npm | 9.0.0 | Latest | Package manager |
| Git | 2.30.0 | Latest | Version control |
| VS Code | 1.70.0 | Latest | IDE (recommended) |

### Initial Setup

#### 1. Clone the Repository

```bash
# Clone via HTTPS
git clone https://github.com/your-org/ipas-net-zero-quiz.git

# Or clone via SSH
git clone git@github.com:your-org/ipas-net-zero-quiz.git

# Navigate to project directory
cd ipas-net-zero-quiz
```

#### 2. Install Dependencies

```bash
# Install all dependencies
npm install

# Verify installation
npm list vue
npm list vite
```

#### 3. Environment Configuration

Create a local environment file:

```bash
# Copy example environment file
cp .env.example .env.local

# Edit with your local settings
# Windows
notepad .env.local

# macOS/Linux
nano .env.local
```

Environment variables:

```env
# Development
VITE_APP_TITLE=iPAS Net Zero Quiz
VITE_DEBUG_MODE=true
VITE_API_TIMEOUT=30000

# Feature Flags
VITE_ENABLE_TIMER=true
VITE_ENABLE_KEYBOARD_NAV=true
VITE_ENABLE_DARK_MODE=false

# Analytics (optional)
VITE_GA_ID=UA-XXXXXXXXX-X
```

#### 4. Verify Setup

```bash
# Run development server
npm run dev

# You should see:
# VITE v5.x.x  ready in xxx ms
# ➜  Local:   http://localhost:5173/
# ➜  Network: http://192.168.x.x:5173/
```

---

## Development Environment Setup

### Recommended VS Code Extensions

Install these extensions for the best development experience:

```json
{
  "recommendations": [
    "Vue.volar",                    // Vue 3 support
    "Vue.vscode-typescript-vue-plugin", // TypeScript support
    "dbaeumer.vscode-eslint",       // ESLint integration
    "esbenp.prettier-vscode",       // Code formatting
    "bradlc.vscode-tailwindcss",    // Tailwind IntelliSense
    "antfu.browse-lite",             // In-editor browser
    "formulahendry.auto-rename-tag", // Auto rename HTML tags
    "naumovs.color-highlight",       // Color preview
    "oderwat.indent-rainbow",        // Indentation guides
    "PKief.material-icon-theme"     // File icons
  ]
}
```

### VS Code Settings

Add to `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "eslint.validate": [
    "javascript",
    "javascriptreact",
    "vue"
  ],
  "volar.takeOverMode.enabled": true,
  "typescript.tsdk": "node_modules/typescript/lib",
  "files.associations": {
    "*.vue": "vue"
  },
  "tailwindCSS.includeLanguages": {
    "vue": "html",
    "vue-html": "html"
  }
}
```

### Browser DevTools Setup

#### Vue DevTools

1. Install Vue DevTools extension:
   - [Chrome](https://chrome.google.com/webstore/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
   - [Firefox](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)

2. Enable in development:
```javascript
// Already configured in main.js
app.config.devtools = true
```

#### Chrome DevTools Settings

1. Enable "Disable cache" in Network tab (while DevTools open)
2. Enable "Preserve log" for debugging
3. Set up Workspaces for live editing

---

## Project Structure

### Directory Layout

```
ipas-net-zero-quiz/
├── .github/              # GitHub Actions workflows
├── .vscode/              # VS Code configuration
├── dist/                 # Production build output
├── docs/                 # Documentation
├── node_modules/         # Dependencies
├── public/               # Static assets
│   └── favicon.svg
├── src/                  # Source code
│   ├── assets/          # App assets
│   │   └── questions.json
│   ├── components/      # Vue components
│   │   ├── QuizView.vue
│   │   ├── QuizHeader.vue
│   │   ├── QuizQuestion.vue
│   │   ├── QuizNavigation.vue
│   │   ├── QuizResults.vue
│   │   ├── QuizProgress.vue
│   │   ├── DarkModeToggle.vue
│   │   ├── LoadingSpinner.vue
│   │   └── ErrorState.vue
│   ├── composables/     # Composition functions
│   │   └── useQuiz.js
│   ├── types/           # TypeScript types
│   │   └── quiz.ts
│   ├── utils/           # Utility functions
│   ├── App.vue          # Root component
│   ├── main.js          # App entry point
│   └── style.css        # Global styles
├── tests/               # Test files
│   ├── unit/
│   └── e2e/
├── .env.example         # Environment variables example
├── .eslintrc.js         # ESLint configuration
├── .gitignore           # Git ignore rules
├── .prettierrc          # Prettier configuration
├── index.html           # HTML template
├── package.json         # Project dependencies
├── package-lock.json    # Locked dependencies
├── postcss.config.js    # PostCSS configuration
├── README.md            # Project readme
├── tailwind.config.js   # Tailwind configuration
├── tsconfig.json        # TypeScript configuration
└── vite.config.js       # Vite configuration
```

### File Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `QuizQuestion.vue` |
| Composables | camelCase with 'use' prefix | `useQuiz.js` |
| Utilities | camelCase | `formatTime.js` |
| Constants | UPPER_SNAKE_CASE | `MAX_QUESTIONS` |
| CSS Files | kebab-case | `quiz-styles.css` |
| Test Files | component.test.js | `QuizView.test.js` |

---

## Development Workflow

### Git Workflow

#### Branch Strategy

```
main
  ├── develop
  │     ├── feature/add-timer
  │     ├── feature/dark-mode
  │     └── feature/analytics
  ├── hotfix/critical-bug
  └── release/v1.2.0
```

#### Branch Naming

- `feature/` - New features
- `bugfix/` - Bug fixes
- `hotfix/` - Urgent production fixes
- `refactor/` - Code refactoring
- `docs/` - Documentation updates
- `test/` - Test additions/fixes

#### Commit Convention

Follow Conventional Commits:

```bash
# Format
<type>(<scope>): <subject>

# Examples
feat(quiz): add timer functionality
fix(navigation): resolve navigation bug
docs(readme): update installation steps
style(components): format code with prettier
refactor(state): simplify state management
test(quiz): add unit tests for scoring
chore(deps): update dependencies
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Code style
- `refactor`: Code refactoring
- `test`: Testing
- `chore`: Maintenance

### Development Process

#### 1. Start New Feature

```bash
# Update develop branch
git checkout develop
git pull origin develop

# Create feature branch
git checkout -b feature/your-feature-name

# Start development server
npm run dev
```

#### 2. Make Changes

```bash
# Check file changes
git status

# Stage changes
git add .

# Commit with message
git commit -m "feat(scope): description"

# Push to remote
git push origin feature/your-feature-name
```

#### 3. Create Pull Request

1. Go to GitHub repository
2. Click "New Pull Request"
3. Select base: `develop`, compare: `feature/your-feature-name`
4. Fill PR template
5. Request review

#### 4. Code Review Process

- [ ] Code follows style guide
- [ ] Tests pass
- [ ] Documentation updated
- [ ] No console errors
- [ ] Performance acceptable
- [ ] Accessibility maintained

---

## Code Standards

### JavaScript/Vue Style Guide

#### General Rules

```javascript
// ✅ Good: Use const for immutable values
const MAX_ATTEMPTS = 3

// ❌ Bad: Using var
var maxAttempts = 3

// ✅ Good: Descriptive names
const calculateQuizScore = (answers) => { }

// ❌ Bad: Unclear names
const calc = (a) => { }

// ✅ Good: Early returns
function validateAnswer(answer) {
  if (!answer) return false
  if (answer.length === 0) return false
  return true
}

// ❌ Bad: Nested conditions
function validateAnswer(answer) {
  if (answer) {
    if (answer.length > 0) {
      return true
    }
  }
  return false
}
```

#### Vue Component Standards

```vue
<template>
  <!-- ✅ Good: Semantic HTML -->
  <article class="quiz-question">
    <header>
      <h2>{{ question.title }}</h2>
    </header>
    <section>
      <!-- Content -->
    </section>
  </article>

  <!-- ❌ Bad: Non-semantic -->
  <div class="quiz-question">
    <div>{{ question.title }}</div>
    <div>
      <!-- Content -->
    </div>
  </div>
</template>

<script setup>
// ✅ Good: Organized imports
import { ref, computed, onMounted } from 'vue'
import { useQuiz } from '@/composables/useQuiz'
import QuizOption from './QuizOption.vue'

// ✅ Good: Props validation
const props = defineProps({
  question: {
    type: Object,
    required: true,
    validator: (value) => {
      return value.id && value.text && value.options
    }
  }
})

// ✅ Good: Descriptive emit names
const emit = defineEmits(['answer-selected', 'question-skipped'])

// ✅ Good: Computed for derived state
const isAnswered = computed(() => selectedAnswer.value !== null)

// ❌ Bad: Direct DOM manipulation
// document.getElementById('question').style.color = 'red'
</script>
```

### CSS/Tailwind Standards

```vue
<style scoped>
/* ✅ Good: Component-scoped styles */
.quiz-question {
  @apply p-6 bg-white rounded-lg shadow-md;
}

/* ✅ Good: Responsive design */
.quiz-container {
  @apply w-full max-w-4xl mx-auto px-4;
  @apply lg:px-6 xl:px-8;
}

/* ❌ Bad: Global styles in components */
body {
  margin: 0;
}

/* ✅ Good: CSS custom properties for themes */
.theme-dark {
  --bg-primary: #1a202c;
  --text-primary: #f7fafc;
}
</style>
```

### File Organization

```javascript
// ✅ Good: Logical grouping
// composables/useQuiz.js
export function useQuiz() {
  // State
  const questions = ref([])
  const currentIndex = ref(0)
  
  // Computed
  const currentQuestion = computed(() => ...)
  const progress = computed(() => ...)
  
  // Methods
  const nextQuestion = () => { }
  const previousQuestion = () => { }
  
  // Lifecycle
  onMounted(() => { })
  
  // Return public API
  return {
    questions: readonly(questions),
    currentQuestion,
    progress,
    nextQuestion,
    previousQuestion
  }
}
```

---

## Component Development

### Creating New Components

#### Component Template

```vue
<!-- components/QuizNewFeature.vue -->
<template>
  <div class="quiz-new-feature">
    <!-- Component content -->
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'

// Props
const props = defineProps({
  // Define props with validation
})

// Emits
const emit = defineEmits(['event-name'])

// State
const localState = ref(null)

// Computed
const derivedValue = computed(() => {
  // Return computed value
})

// Methods
const handleAction = () => {
  // Handle action
  emit('event-name', payload)
}

// Lifecycle
onMounted(() => {
  // Component mounted
})
</script>

<style scoped>
.quiz-new-feature {
  /* Component styles */
}
</style>
```

### Component Composition Patterns

#### 1. Container/Presentational Pattern

```vue
<!-- Container Component -->
<template>
  <QuizQuestionPresentation
    :question="currentQuestion"
    :is-answered="isAnswered"
    @select-answer="handleAnswer"
  />
</template>

<script setup>
// Handles logic and state
const { currentQuestion, handleAnswer } = useQuiz()
</script>

<!-- Presentational Component -->
<template>
  <div class="question">
    <h2>{{ question.text }}</h2>
    <button 
      v-for="option in question.options"
      :key="option.id"
      @click="$emit('select-answer', option.id)"
    >
      {{ option.text }}
    </button>
  </div>
</template>

<script setup>
// Only handles presentation
defineProps(['question', 'isAnswered'])
defineEmits(['select-answer'])
</script>
```

#### 2. Composable Pattern

```javascript
// composables/useTimer.js
export function useTimer(duration = 60) {
  const timeLeft = ref(duration)
  const isRunning = ref(false)
  const interval = ref(null)
  
  const start = () => {
    isRunning.value = true
    interval.value = setInterval(() => {
      timeLeft.value--
      if (timeLeft.value <= 0) {
        stop()
      }
    }, 1000)
  }
  
  const stop = () => {
    isRunning.value = false
    if (interval.value) {
      clearInterval(interval.value)
    }
  }
  
  const reset = () => {
    stop()
    timeLeft.value = duration
  }
  
  onUnmounted(() => stop())
  
  return { timeLeft, isRunning, start, stop, reset }
}

// Usage in component
const { timeLeft, start, stop } = useTimer(30)
```

### Props and Events Best Practices

```vue
<script setup>
// ✅ Good: Detailed prop validation
const props = defineProps({
  question: {
    type: Object,
    required: true,
    validator(value) {
      return (
        typeof value.id === 'string' &&
        typeof value.text === 'string' &&
        Array.isArray(value.options) &&
        value.options.length === 4
      )
    }
  },
  timeLimit: {
    type: Number,
    default: 60,
    validator: (value) => value > 0 && value <= 300
  }
})

// ✅ Good: Typed emits with validation
const emit = defineEmits({
  'answer-selected': (payload) => {
    return typeof payload === 'string'
  },
  'time-expired': null
})
</script>
```

---

## State Management

### State Architecture

```javascript
// Core state structure
const state = {
  // Quiz data
  questions: [],
  currentQuestionIndex: 0,
  
  // User data
  answers: new Map(),
  score: 0,
  
  // UI state
  isLoading: false,
  error: null,
  
  // Settings
  config: {
    shuffleQuestions: false,
    timePerQuestion: 60
  }
}
```

### State Management Patterns

#### 1. Reactive State

```javascript
// composables/useQuizState.js
import { reactive, computed, toRefs } from 'vue'

export function useQuizState() {
  // Reactive state
  const state = reactive({
    questions: [],
    currentIndex: 0,
    answers: new Map()
  })
  
  // Computed getters
  const currentQuestion = computed(() => 
    state.questions[state.currentIndex]
  )
  
  const progress = computed(() => 
    (state.currentIndex / state.questions.length) * 100
  )
  
  // Actions
  const selectAnswer = (questionId, answer) => {
    state.answers.set(questionId, answer)
  }
  
  const nextQuestion = () => {
    if (state.currentIndex < state.questions.length - 1) {
      state.currentIndex++
    }
  }
  
  return {
    ...toRefs(state),
    currentQuestion,
    progress,
    selectAnswer,
    nextQuestion
  }
}
```

#### 2. Global State Store

```javascript
// stores/quizStore.js
import { reactive, readonly } from 'vue'

const state = reactive({
  user: null,
  settings: {},
  history: []
})

const mutations = {
  setUser(user) {
    state.user = user
  },
  updateSettings(settings) {
    state.settings = { ...state.settings, ...settings }
  },
  addToHistory(entry) {
    state.history.push(entry)
  }
}

const actions = {
  async loadUser() {
    const user = await fetchUser()
    mutations.setUser(user)
  }
}

export default {
  state: readonly(state),
  mutations,
  actions
}
```

---

## Testing

### Unit Testing

#### Setup

```bash
# Install testing dependencies
npm install -D @vue/test-utils vitest @testing-library/vue
```

#### Component Test Example

```javascript
// tests/unit/QuizQuestion.test.js
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import QuizQuestion from '@/components/QuizQuestion.vue'

describe('QuizQuestion', () => {
  const mockQuestion = {
    id: 'q1',
    text: 'What is Vue?',
    options: [
      { id: 'a', text: 'Framework' },
      { id: 'b', text: 'Library' },
      { id: 'c', text: 'Language' },
      { id: 'd', text: 'Database' }
    ],
    answer: 'a'
  }
  
  it('renders question text', () => {
    const wrapper = mount(QuizQuestion, {
      props: { question: mockQuestion }
    })
    
    expect(wrapper.text()).toContain('What is Vue?')
  })
  
  it('displays all options', () => {
    const wrapper = mount(QuizQuestion, {
      props: { question: mockQuestion }
    })
    
    const options = wrapper.findAll('.option')
    expect(options).toHaveLength(4)
  })
  
  it('emits answer-selected when option clicked', async () => {
    const wrapper = mount(QuizQuestion, {
      props: { question: mockQuestion }
    })
    
    await wrapper.find('.option').trigger('click')
    
    expect(wrapper.emitted('answer-selected')).toBeTruthy()
    expect(wrapper.emitted('answer-selected')[0]).toEqual(['a'])
  })
  
  it('disables options after answer', async () => {
    const wrapper = mount(QuizQuestion, {
      props: { 
        question: mockQuestion,
        isAnswered: true
      }
    })
    
    const options = wrapper.findAll('.option')
    options.forEach(option => {
      expect(option.attributes('disabled')).toBeDefined()
    })
  })
})
```

#### Composable Test Example

```javascript
// tests/unit/useQuiz.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { useQuiz } from '@/composables/useQuiz'

describe('useQuiz', () => {
  let quiz
  
  beforeEach(() => {
    const questions = [
      { id: '1', answer: 'A' },
      { id: '2', answer: 'B' }
    ]
    quiz = useQuiz(questions)
  })
  
  it('initializes with first question', () => {
    expect(quiz.currentQuestionIndex.value).toBe(0)
    expect(quiz.currentQuestion.value.id).toBe('1')
  })
  
  it('calculates score correctly', () => {
    quiz.answerQuestion('A') // Correct
    quiz.nextQuestion()
    quiz.answerQuestion('C') // Wrong
    
    expect(quiz.score.value.correct).toBe(1)
    expect(quiz.score.value.percentage).toBe(50)
  })
  
  it('saves to localStorage', () => {
    quiz.answerQuestion('A')
    quiz.saveToStorage()
    
    const saved = localStorage.getItem('ipas-quiz-state')
    expect(saved).toBeDefined()
    
    const state = JSON.parse(saved)
    expect(state.currentQuestionIndex).toBe(0)
  })
})
```

### E2E Testing

```javascript
// tests/e2e/quiz-flow.test.js
import { test, expect } from '@playwright/test'

test.describe('Quiz Flow', () => {
  test('complete quiz flow', async ({ page }) => {
    // Navigate to app
    await page.goto('http://localhost:5173')
    
    // Start quiz
    await page.click('text=開始測驗')
    
    // Answer first question
    await page.click('.option:first-child')
    
    // Check feedback
    await expect(page.locator('.feedback')).toBeVisible()
    
    // Go to next question
    await page.click('text=下一題')
    
    // Continue answering...
    // ...
    
    // Check results
    await expect(page.locator('.results')).toContainText('測驗完成')
  })
})
```

---

## Debugging

### Vue DevTools

#### Component Inspector

1. Open Vue DevTools
2. Select component in tree
3. Inspect:
   - Props
   - Data
   - Computed properties
   - Events

#### Timeline

1. Enable recording
2. Interact with app
3. Analyze:
   - Component updates
   - Event emissions
   - Performance metrics

### Browser DevTools

#### Console Debugging

```javascript
// Add debug statements
console.log('Current state:', state)
console.table(questions)
console.time('Operation')
// ... code ...
console.timeEnd('Operation')

// Conditional debugging
if (import.meta.env.DEV) {
  console.log('Debug info:', debugData)
}
```

#### Network Debugging

1. Open Network tab
2. Check:
   - Asset loading
   - API calls
   - Response times
   - Cache behavior

### Common Debugging Scenarios

#### 1. Component Not Updating

```javascript
// Check reactivity
console.log('Is reactive?', isReactive(state))
console.log('Is ref?', isRef(value))

// Force update (debugging only)
import { nextTick } from 'vue'
await nextTick()

// Check computed dependencies
console.log('Dependencies:', computedValue.effect.deps)
```

#### 2. Event Not Firing

```javascript
// Log all emitted events
onMounted(() => {
  if (import.meta.env.DEV) {
    const emit = getCurrentInstance().emit
    getCurrentInstance().emit = (...args) => {
      console.log('Emit:', args)
      return emit(...args)
    }
  }
})
```

#### 3. State Management Issues

```javascript
// Create state snapshot
function debugState() {
  return {
    state: JSON.parse(JSON.stringify(toRaw(state))),
    localStorage: { ...localStorage },
    timestamp: Date.now()
  }
}

// Compare states
const before = debugState()
// ... perform action ...
const after = debugState()
console.log('State diff:', diff(before, after))
```

---

## Best Practices

### Performance Optimization

#### 1. Component Lazy Loading

```javascript
// router/index.js
const routes = [
  {
    path: '/results',
    component: () => import('@/views/ResultsView.vue')
  }
]
```

#### 2. Computed Caching

```javascript
// ✅ Good: Computed for expensive operations
const sortedQuestions = computed(() => 
  questions.value.slice().sort((a, b) => a.order - b.order)
)

// ❌ Bad: Recalculating in template
<div v-for="q in questions.slice().sort(...)" />
```

#### 3. List Rendering Optimization

```vue
<!-- ✅ Good: Use key for list items -->
<div v-for="item in items" :key="item.id">

<!-- ✅ Good: Use v-show for toggling -->
<div v-show="isVisible">

<!-- ❌ Bad: v-if in loops -->
<div v-for="item in items" v-if="item.visible">
```

### Security Best Practices

#### 1. Input Sanitization

```javascript
// Sanitize user input
function sanitizeInput(input) {
  return DOMPurify.sanitize(input)
}

// Validate data structure
function validateQuestion(question) {
  const schema = {
    id: 'string',
    text: 'string',
    options: 'array',
    answer: 'string'
  }
  
  return validate(question, schema)
}
```

#### 2. Secure Storage

```javascript
// Don't store sensitive data
// ❌ Bad
localStorage.setItem('apiKey', 'secret-key')

// ✅ Good: Only store non-sensitive data
localStorage.setItem('quizProgress', JSON.stringify(progress))
```

### Accessibility (a11y)

```vue
<!-- ✅ Good: Semantic HTML and ARIA -->
<button
  :aria-label="`Select option ${option.label}`"
  :aria-pressed="isSelected"
  @click="selectOption"
>
  {{ option.text }}
</button>

<!-- ✅ Good: Keyboard navigation -->
<div
  tabindex="0"
  @keydown.enter="handleAction"
  @keydown.space.prevent="handleAction"
>

<!-- ✅ Good: Screen reader announcements -->
<div class="sr-only" aria-live="polite">
  {{ announcement }}
</div>
```

---

## Common Tasks

### Adding a New Question Type

```javascript
// 1. Define the type
// types/quiz.ts
export interface MultipleChoiceQuestion extends Question {
  type: 'multiple-choice'
  allowMultiple: boolean
  correctAnswers: string[]
}

// 2. Create component
// components/QuizMultipleChoice.vue
<template>
  <div class="multiple-choice">
    <div v-for="option in question.options" :key="option.id">
      <input
        :type="question.allowMultiple ? 'checkbox' : 'radio'"
        :name="question.id"
        :value="option.id"
        @change="handleSelection"
      />
      <label>{{ option.text }}</label>
    </div>
  </div>
</template>

// 3. Update handler
const handleSelection = (event) => {
  if (question.allowMultiple) {
    // Handle multiple selections
  } else {
    // Handle single selection
  }
}
```

### Adding Analytics

```javascript
// utils/analytics.js
export const analytics = {
  trackEvent(category, action, label, value) {
    if (window.gtag) {
      window.gtag('event', action, {
        event_category: category,
        event_label: label,
        value: value
      })
    }
  },
  
  trackQuizStart() {
    this.trackEvent('Quiz', 'start', 'Quiz Started')
  },
  
  trackAnswer(questionId, isCorrect) {
    this.trackEvent('Quiz', 'answer', questionId, isCorrect ? 1 : 0)
  },
  
  trackCompletion(score) {
    this.trackEvent('Quiz', 'complete', 'Quiz Completed', score)
  }
}

// Usage in component
import { analytics } from '@/utils/analytics'

const startQuiz = () => {
  analytics.trackQuizStart()
  // ... start quiz logic
}
```

### Implementing Dark Mode

```javascript
// composables/useDarkMode.js
export function useDarkMode() {
  const isDark = ref(false)
  
  const toggle = () => {
    isDark.value = !isDark.value
    updateTheme()
  }
  
  const updateTheme = () => {
    if (isDark.value) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }
  
  onMounted(() => {
    const saved = localStorage.getItem('theme')
    isDark.value = saved === 'dark'
    updateTheme()
  })
  
  return { isDark, toggle }
}
```

---

## Troubleshooting

### Common Issues and Solutions

#### 1. Build Errors

```bash
# Error: Cannot find module
npm ci  # Clean install

# Error: Vite build failed
npm run build -- --debug

# Error: TypeScript errors
npm run type-check
```

#### 2. Runtime Errors

```javascript
// Error: Cannot read property of undefined
// Solution: Add optional chaining
const value = data?.property?.nested

// Error: Maximum call stack exceeded
// Solution: Check for infinite loops in watchers
watch(value, (newVal) => {
  // Don't modify watched value here
})
```

#### 3. Performance Issues

```javascript
// Slow rendering
// Solution: Use v-show instead of v-if for frequently toggled elements
<div v-show="isVisible"> // Better for toggling

// Memory leaks
// Solution: Clean up in onUnmounted
onUnmounted(() => {
  clearInterval(timer)
  removeEventListener('resize', handler)
})
```

### Debug Checklist

- [ ] Check browser console for errors
- [ ] Verify network requests in DevTools
- [ ] Check Vue DevTools for component state
- [ ] Validate props and emits
- [ ] Test in different browsers
- [ ] Clear cache and localStorage
- [ ] Check for conflicting CSS
- [ ] Verify environment variables

---

## Resources

### Internal Documentation

- [API Documentation](./api-documentation.md)
- [Architecture Overview](./architecture-overview.md)
- [State Management](./state-management.md)
- [Configuration Guide](./configuration-guide.md)

### External Resources

- [Vue 3 Documentation](https://vuejs.org/)
- [Vite Documentation](https://vitejs.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Vue Test Utils](https://test-utils.vuejs.org/)
- [Vitest](https://vitest.dev/)

### Learning Resources

- [Vue Mastery](https://www.vuemastery.com/)
- [Vue School](https://vueschool.io/)
- [Composition API RFC](https://github.com/vuejs/rfcs/blob/master/active-rfcs/0013-composition-api.md)

### Community

- [Vue Discord](https://discord.com/invite/HBherRA)
- [Vue Forum](https://forum.vuejs.org/)
- [Stack Overflow](https://stackoverflow.com/questions/tagged/vue.js)

---

## Appendix

### Useful Commands

```bash
# Development
npm run dev           # Start dev server
npm run build        # Build for production
npm run preview      # Preview production build

# Testing
npm run test         # Run all tests
npm run test:unit    # Run unit tests
npm run test:e2e     # Run E2E tests
npm run coverage     # Generate coverage report

# Code Quality
npm run lint         # Lint code
npm run lint:fix     # Auto-fix lint issues
npm run format       # Format with Prettier
npm run type-check   # TypeScript check

# Dependencies
npm outdated         # Check for updates
npm update          # Update dependencies
npm audit           # Security audit
npm audit fix       # Fix vulnerabilities

# Git
git stash           # Save changes temporarily
git stash pop       # Restore stashed changes
git reset --hard    # Reset to last commit
git clean -fd       # Remove untracked files
```

### VS Code Snippets

Add to `.vscode/snippets.code-snippets`:

```json
{
  "Vue Component": {
    "prefix": "vcomp",
    "body": [
      "<template>",
      "  <div class=\"${1:component-name}\">",
      "    $2",
      "  </div>",
      "</template>",
      "",
      "<script setup>",
      "import { ref, computed } from 'vue'",
      "",
      "const props = defineProps({",
      "  $3",
      "})",
      "",
      "const emit = defineEmits(['$4'])",
      "",
      "$0",
      "</script>",
      "",
      "<style scoped>",
      ".${1:component-name} {",
      "  ",
      "}",
      "</style>"
    ]
  }
}
```

---

*Last Updated: 2025-08-21*

*Welcome to the team! If you have questions, don't hesitate to ask in the development channel.*