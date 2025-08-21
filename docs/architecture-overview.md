# Architecture Overview

## System Architecture

The iPAS Net Zero Quiz Application is built using a modern, component-based architecture with Vue 3 as the core framework. The application follows a unidirectional data flow pattern and leverages the Composition API for state management.

## Table of Contents

1. [High-Level Architecture](#high-level-architecture)
2. [Component Hierarchy](#component-hierarchy)
3. [Data Flow Architecture](#data-flow-architecture)
4. [State Management Architecture](#state-management-architecture)
5. [File Structure](#file-structure)
6. [Build Architecture](#build-architecture)
7. [Deployment Architecture](#deployment-architecture)

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser Environment                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │                  Vue 3 Application                  │     │
│  ├────────────────────────────────────────────────────┤     │
│  │                                                     │     │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │     │
│  │  │  Components  │  │  Composables │  │  Assets  │ │     │
│  │  └──────────────┘  └──────────────┘  └──────────┘ │     │
│  │                                                     │     │
│  │  ┌──────────────────────────────────────────────┐  │     │
│  │  │           State Management Layer             │  │     │
│  │  │         (useQuiz Composable)                │  │     │
│  │  └──────────────────────────────────────────────┘  │     │
│  │                                                     │     │
│  │  ┌──────────────────────────────────────────────┐  │     │
│  │  │           Persistence Layer                  │  │     │
│  │  │            (localStorage API)               │  │     │
│  │  └──────────────────────────────────────────────┘  │     │
│  └────────────────────────────────────────────────────┘     │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │                 Vite Build System                  │     │
│  │          (HMR, Bundling, Optimization)            │     │
│  └────────────────────────────────────────────────────┘     │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │                 Tailwind CSS Layer                 │     │
│  │            (Utility-First Styling)                │     │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### Architecture Principles

1. **Component-Based Design**: Modular, reusable components
2. **Reactive State Management**: Vue 3 Composition API
3. **Unidirectional Data Flow**: Props down, events up
4. **Client-Side Rendering**: SPA architecture
5. **Progressive Enhancement**: Works without JavaScript (basic view)
6. **Mobile-First Design**: Responsive from the ground up

---

## Component Hierarchy

```
App.vue
└── QuizView.vue (Main Container)
    ├── QuizHeader.vue
    │   └── QuizProgress.vue (embedded)
    ├── QuizQuestion.vue
    │   ├── Question Display
    │   ├── Option Buttons
    │   └── Feedback Messages
    ├── QuizNavigation.vue
    │   ├── Previous Button
    │   ├── Next Button
    │   └── Complete Button
    ├── QuizResults.vue
    │   ├── Score Display
    │   ├── Performance Analysis
    │   └── Action Buttons
    ├── LoadingSpinner.vue
    ├── ErrorState.vue
    └── DarkModeToggle.vue
```

### Component Relationships

#### Parent-Child Communication

```
QuizView (Parent)
    ↓ Props: question, selectedAnswer, score
    ↓
QuizQuestion (Child)
    ↑ Events: @answer-selected
    ↑
QuizView (Parent)
```

#### Sibling Communication (via Parent)

```
QuizQuestion → QuizView → QuizNavigation
           Events ↑    ↓ Props
```

### Component Responsibilities

| Component | Primary Responsibility | Secondary Responsibilities |
|-----------|----------------------|---------------------------|
| **App.vue** | Application root | Style initialization |
| **QuizView.vue** | Quiz orchestration | State management, flow control |
| **QuizHeader.vue** | Progress display | Title, subject information |
| **QuizQuestion.vue** | Question rendering | Answer validation, feedback |
| **QuizNavigation.vue** | Navigation controls | Flow management |
| **QuizResults.vue** | Results display | Statistics, performance analysis |
| **QuizProgress.vue** | Progress visualization | Percentage calculation |
| **DarkModeToggle.vue** | Theme switching | Preference persistence |
| **LoadingSpinner.vue** | Loading states | User feedback |
| **ErrorState.vue** | Error handling | Recovery options |

---

## Data Flow Architecture

### Unidirectional Data Flow

```
┌─────────────────────────────────────────────────────┐
│                   User Interaction                   │
└─────────────────────┬───────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│                  Event Emission                      │
│            (answer-selected, next, etc.)            │
└─────────────────────┬───────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│                 State Mutation                       │
│              (useQuiz composable)                   │
└─────────────────────┬───────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│              Computed Properties                     │
│         (derived state calculations)                │
└─────────────────────┬───────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│                 Props Update                         │
│          (data flows to components)                 │
└─────────────────────┬───────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│                  UI Re-render                        │
│           (Virtual DOM reconciliation)              │
└─────────────────────────────────────────────────────┘
```

### Data Flow Examples

#### Answer Selection Flow

```
1. User clicks answer option
   └→ QuizQuestion: @click handler
      └→ Emit: 'answer-selected' with optionKey
         └→ QuizView: selectAnswer(optionKey)
            └→ Update: selectedAnswer, score, questionsAnswered
               └→ Trigger: UI update with feedback
                  └→ After delay: nextQuestion()
```

#### Quiz Completion Flow

```
1. Last question answered
   └→ QuizView: isQuizComplete computed = true
      └→ Conditional render: QuizResults component
         └→ Calculate: final score, statistics
            └→ Save: results to localStorage
               └→ Display: performance analysis
```

---

## State Management Architecture

### State Layers

```
┌────────────────────────────────────────────────────────┐
│                    Global State                        │
│                  (useQuiz Composable)                 │
├────────────────────────────────────────────────────────┤
│ • questions: Array<Question>                          │
│ • currentQuestionIndex: Number                        │
│ • userAnswers: Map<questionId, answer>               │
│ • statistics: Object                                  │
│ • configuration: Object                               │
└────────────────────────────────────────────────────────┘
                           ↓
┌────────────────────────────────────────────────────────┐
│                   Component State                      │
│                    (Local Refs)                       │
├────────────────────────────────────────────────────────┤
│ • selectedAnswer: String|null                         │
│ • isLoading: Boolean                                  │
│ • error: Error|null                                   │
└────────────────────────────────────────────────────────┘
                           ↓
┌────────────────────────────────────────────────────────┐
│                  Persistent State                      │
│                   (localStorage)                      │
├────────────────────────────────────────────────────────┤
│ • ipas-quiz-state: Quiz progress                      │
│ • ipas-quiz-answers: User answers                     │
│ • ipas-quiz-statistics: Performance data              │
│ • ipas-quiz-config: User preferences                  │
└────────────────────────────────────────────────────────┘
```

### State Management Patterns

#### Reactive State Pattern

```javascript
// Reactive state definition
const state = reactive({
  questions: [],
  currentIndex: 0,
  answers: new Map()
})

// Computed derived state
const currentQuestion = computed(() => 
  state.questions[state.currentIndex]
)

// State mutation
function selectAnswer(answer) {
  state.answers.set(currentQuestion.value.id, answer)
}
```

#### Composable Pattern

```javascript
// Encapsulated state logic
export function useQuiz(questions) {
  // Private state
  const state = reactive({...})
  
  // Public interface
  return {
    // Readonly state
    questions: readonly(state.questions),
    // Methods
    selectAnswer,
    nextQuestion,
    // Computed
    score: computed(() => calculateScore(state))
  }
}
```

---

## File Structure

### Project Directory Structure

```
ipas-net-zero-quiz/
├── public/                    # Static assets
│   └── favicon.svg           # Application icon
├── src/                      # Source code
│   ├── assets/              # Application assets
│   │   └── questions.json   # Quiz questions data
│   ├── components/          # Vue components
│   │   ├── QuizView.vue    # Main quiz container
│   │   ├── QuizHeader.vue  # Header component
│   │   ├── QuizQuestion.vue # Question display
│   │   ├── QuizNavigation.vue # Navigation controls
│   │   ├── QuizResults.vue # Results display
│   │   ├── QuizProgress.vue # Progress indicator
│   │   ├── DarkModeToggle.vue # Theme switcher
│   │   ├── LoadingSpinner.vue # Loading indicator
│   │   └── ErrorState.vue  # Error display
│   ├── composables/         # Composition functions
│   │   ├── useQuiz.js      # Quiz state management
│   │   └── useQuiz.ts      # TypeScript definitions
│   ├── types/               # Type definitions
│   │   └── quiz.ts         # Quiz type interfaces
│   ├── App.vue             # Root component
│   ├── main.js             # Application entry
│   └── style.css           # Global styles
├── docs/                    # Documentation
│   ├── README.md           # Documentation index
│   ├── api-documentation.md # API reference
│   ├── architecture-overview.md # This file
│   └── ...                 # Other docs
├── dist/                    # Build output
├── index.html              # HTML entry point
├── package.json            # Dependencies
├── vite.config.js          # Vite configuration
├── tailwind.config.js      # Tailwind configuration
├── postcss.config.js       # PostCSS configuration
└── questions.json          # Quiz data source
```

### Module Organization

#### Component Modules

```
components/
├── Core/                   # Core functionality
│   ├── QuizView.vue
│   └── QuizQuestion.vue
├── UI/                     # UI components
│   ├── QuizHeader.vue
│   ├── QuizProgress.vue
│   └── LoadingSpinner.vue
├── Navigation/             # Navigation
│   └── QuizNavigation.vue
└── Results/               # Results display
    └── QuizResults.vue
```

#### State Modules

```
composables/
├── useQuiz.js             # Main quiz logic
├── useTimer.js            # Timer functionality
├── useStorage.js          # Storage operations
└── useKeyboard.js         # Keyboard shortcuts
```

---

## Build Architecture

### Build Pipeline

```
Source Files → Vite → Rollup → Optimized Bundle
     ↓           ↓       ↓            ↓
   .vue      Transform  Bundle    index.html
   .js       Compile    Minify    app.[hash].js
   .css      Process    Optimize   app.[hash].css
```

### Build Process Flow

```
┌──────────────────────────────────────────┐
│           Development Build              │
├──────────────────────────────────────────┤
│ 1. Vite Dev Server Start                │
│ 2. File System Watcher                  │
│ 3. Hot Module Replacement (HMR)         │
│ 4. ES Module Serving                    │
│ 5. Vue SFC Compilation                  │
│ 6. Tailwind JIT Compilation            │
└──────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────┐
│          Production Build                │
├──────────────────────────────────────────┤
│ 1. TypeScript Type Checking             │
│ 2. Vue Template Compilation             │
│ 3. JavaScript Minification              │
│ 4. CSS Purging & Minification          │
│ 5. Asset Optimization                   │
│ 6. Code Splitting                       │
│ 7. Tree Shaking                         │
│ 8. Hash Generation                      │
│ 9. Source Map Generation                │
└──────────────────────────────────────────┘
```

### Build Optimization Strategies

1. **Code Splitting**
   - Lazy load components
   - Dynamic imports for routes
   - Vendor chunk separation

2. **Asset Optimization**
   - Image compression
   - SVG optimization
   - Font subsetting

3. **Bundle Size Optimization**
   - Tree shaking unused code
   - Tailwind CSS purging
   - Minification and compression

4. **Performance Optimizations**
   - Preloading critical assets
   - Prefetching next resources
   - Service worker caching

---

## Deployment Architecture

### Deployment Options

#### Static Hosting (Recommended)

```
┌─────────────────────────────────────────┐
│              CDN Edge Network           │
├─────────────────────────────────────────┤
│   ┌──────────┐  ┌──────────┐           │
│   │  HTML    │  │   CSS    │           │
│   └──────────┘  └──────────┘           │
│   ┌──────────┐  ┌──────────┐           │
│   │    JS    │  │  Assets  │           │
│   └──────────┘  └──────────┘           │
└─────────────────────────────────────────┘
           ↓              ↓
    Global Edge      Cached Content
    Distribution     Low Latency
```

#### Container Deployment

```
┌─────────────────────────────────────────┐
│           Docker Container              │
├─────────────────────────────────────────┤
│  ┌──────────────────────────────────┐  │
│  │         Nginx Web Server         │  │
│  ├──────────────────────────────────┤  │
│  │  • Static file serving           │  │
│  │  • Gzip compression             │  │
│  │  • Cache headers                │  │
│  │  • SPA routing                  │  │
│  └──────────────────────────────────┘  │
│  ┌──────────────────────────────────┐  │
│  │      Application Files           │  │
│  │       /usr/share/nginx/html      │  │
│  └──────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### Deployment Pipeline

```
1. Code Push
   └→ 2. CI/CD Trigger
      └→ 3. Install Dependencies
         └→ 4. Run Tests
            └→ 5. Build Application
               └→ 6. Optimize Assets
                  └→ 7. Deploy to CDN
                     └→ 8. Cache Invalidation
                        └→ 9. Health Check
```

### Environment Configuration

#### Development Environment

```javascript
// .env.development
VITE_API_URL=http://localhost:3000
VITE_DEBUG=true
VITE_MOCK_DATA=true
```

#### Production Environment

```javascript
// .env.production
VITE_API_URL=https://api.ipas-quiz.com
VITE_DEBUG=false
VITE_ANALYTICS_ID=UA-XXXXXXXX
```

---

## Security Architecture

### Security Layers

```
┌────────────────────────────────────────┐
│         Content Security Policy        │
│    (XSS Protection, Script Control)   │
└────────────────────────────────────────┘
                    ↓
┌────────────────────────────────────────┐
│          Input Sanitization           │
│     (User Input, Storage Data)        │
└────────────────────────────────────────┘
                    ↓
┌────────────────────────────────────────┐
│         Secure Storage                │
│    (Encrypted localStorage)           │
└────────────────────────────────────────┘
```

### Security Best Practices

1. **XSS Prevention**
   - Vue automatic escaping
   - CSP headers
   - Input validation

2. **Data Protection**
   - No sensitive data in localStorage
   - HTTPS only deployment
   - Secure cookie settings

3. **Dependencies**
   - Regular security audits
   - Dependency updates
   - Lock file verification

---

## Performance Architecture

### Performance Optimization Layers

```
┌────────────────────────────────────────┐
│      Initial Load Optimization        │
│   (Critical CSS, Preload, Compress)   │
└────────────────────────────────────────┘
                    ↓
┌────────────────────────────────────────┐
│       Runtime Optimization            │
│  (Virtual DOM, Computed Caching)      │
└────────────────────────────────────────┘
                    ↓
┌────────────────────────────────────────┐
│        Asset Optimization             │
│    (Lazy Loading, Code Splitting)     │
└────────────────────────────────────────┘
```

### Performance Metrics

| Metric | Target | Strategy |
|--------|--------|----------|
| First Contentful Paint | < 1.5s | Critical CSS inlining |
| Time to Interactive | < 3.0s | Code splitting |
| Largest Contentful Paint | < 2.5s | Image optimization |
| Cumulative Layout Shift | < 0.1 | Reserved space for dynamic content |
| First Input Delay | < 100ms | Main thread optimization |

---

## Scalability Considerations

### Horizontal Scaling

```
         Load Balancer
              ↓
    ┌────────┴────────┐
    ↓                 ↓
CDN Edge 1        CDN Edge 2
    ↓                 ↓
  Users            Users
```

### Vertical Scaling

- Component lazy loading
- Progressive data loading
- Pagination for large datasets
- Virtual scrolling for lists

### Future Architecture Enhancements

1. **Micro-Frontend Architecture**
   - Module federation
   - Independent deployments
   - Team autonomy

2. **Server-Side Rendering (SSR)**
   - SEO optimization
   - Initial load performance
   - Progressive enhancement

3. **Progressive Web App (PWA)**
   - Offline functionality
   - Push notifications
   - App-like experience

4. **Real-time Features**
   - WebSocket integration
   - Live quiz sessions
   - Multiplayer support

---

## Architecture Decision Records (ADRs)

### ADR-001: Vue 3 Composition API

**Decision**: Use Composition API instead of Options API

**Rationale**:
- Better TypeScript support
- Improved code organization
- Enhanced reusability
- Better tree-shaking

### ADR-002: Client-Side State Management

**Decision**: Use composables instead of Vuex/Pinia

**Rationale**:
- Simpler for small-medium apps
- No additional dependencies
- Direct integration with Vue 3
- Easier testing

### ADR-003: Tailwind CSS

**Decision**: Use Tailwind for styling

**Rationale**:
- Rapid development
- Consistent design system
- Small production bundle
- Good documentation

### ADR-004: Vite Build Tool

**Decision**: Use Vite instead of Webpack

**Rationale**:
- Faster development experience
- Native ES modules
- Optimized production builds
- Vue official recommendation

---

*Last Updated: 2025-08-21*