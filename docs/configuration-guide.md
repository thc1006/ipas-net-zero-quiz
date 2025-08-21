# Configuration Guide - questions.json Format

## Table of Contents

1. [Overview](#overview)
2. [JSON Structure](#json-structure)
3. [Question Schema](#question-schema)
4. [Field Specifications](#field-specifications)
5. [Validation Rules](#validation-rules)
6. [Examples](#examples)
7. [Best Practices](#best-practices)
8. [Localization](#localization)
9. [Advanced Features](#advanced-features)
10. [Migration Guide](#migration-guide)

---

## Overview

The `questions.json` file is the core data source for the iPAS Net Zero Quiz Application. This guide provides comprehensive documentation on the structure, format, and configuration options for quiz questions.

### File Location

```
src/assets/questions.json   # Development
dist/assets/questions.json  # Production
questions.json              # Root (backup)
```

### Purpose

The questions.json file serves as:
- Primary question database
- Configuration for quiz behavior
- Source for localized content
- Template for question imports

---

## JSON Structure

### Basic Structure

```json
[
  {
    "id": "unique-question-id",
    "subject": "Question category",
    "question": "Question text",
    "options": {
      "A": "First option",
      "B": "Second option",
      "C": "Third option",
      "D": "Fourth option"
    },
    "answer": "A",
    "explanation": "Optional explanation"
  }
]
```

### Complete Structure with All Fields

```json
[
  {
    "id": "c1-001",
    "subject": "考科一：淨零碳規劃管理基礎概論",
    "category": "ISO Standards",
    "subcategory": "ISO 14064-1:2018",
    "difficulty": "medium",
    "question": "依據 ISO 14064‑1:2018 標準，下列何者「屬於」其他間接排放（類別 4）的範疇？",
    "options": {
      "A": "商務差旅的排放",
      "B": "租賃資產的排放",
      "C": "員工通勤的排放",
      "D": "購入的電力使用"
    },
    "answer": "B",
    "explanation": "根據ISO 14064-1:2018，類別4指的是「由組織使用的產品所產生之間接溫室氣體排放」，其中包括外購商品、資本商品、上游租賃資產、外購服務和廢物處理。",
    "references": ["ISO 14064-1:2018 Section 5.2.4", "GHG Protocol Scope 3"],
    "tags": ["ISO", "GHG", "Scope 3", "間接排放"],
    "weight": 1,
    "timeLimit": 90,
    "points": 2,
    "mediaUrl": null,
    "relatedQuestions": ["c1-002", "c1-003"],
    "metadata": {
      "author": "Quiz Admin",
      "createdAt": "2025-08-01T00:00:00Z",
      "updatedAt": "2025-08-21T00:00:00Z",
      "version": "1.0.0",
      "reviewedBy": "Subject Expert",
      "approvedBy": "Course Director"
    }
  }
]
```

---

## Question Schema

### TypeScript Definition

```typescript
interface Question {
  // Required fields
  id: string;                    // Unique identifier
  subject: string;                // Subject/exam category
  question: string;               // Question text
  options: Options;               // Answer options
  answer: AnswerKey;             // Correct answer key
  
  // Optional fields
  explanation?: string;           // Answer explanation
  category?: string;              // Main category
  subcategory?: string;           // Sub-category
  difficulty?: Difficulty;        // Question difficulty
  references?: string[];          // Reference materials
  tags?: string[];               // Searchable tags
  weight?: number;               // Question weight in scoring
  timeLimit?: number;            // Time limit in seconds
  points?: number;               // Point value
  mediaUrl?: string | null;      // Associated media
  relatedQuestions?: string[];   // Related question IDs
  metadata?: QuestionMetadata;   // Additional metadata
}

interface Options {
  A: string;
  B: string;
  C: string;
  D: string;
  E?: string;  // Optional 5th option
  F?: string;  // Optional 6th option
}

type AnswerKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

interface QuestionMetadata {
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  version?: string;
  reviewedBy?: string;
  approvedBy?: string;
  language?: string;
  region?: string;
}
```

---

## Field Specifications

### Required Fields

#### `id` (string)
- **Purpose**: Unique identifier for the question
- **Format**: `[category]-[number]` (e.g., "c1-001")
- **Constraints**: Must be unique across all questions
- **Example**: `"c1-001"`, `"net-zero-basics-001"`

#### `subject` (string)
- **Purpose**: Categorizes question by exam subject
- **Format**: Free text, typically includes exam section
- **Example**: `"考科一：淨零碳規劃管理基礎概論"`
- **Best Practice**: Use consistent naming convention

#### `question` (string)
- **Purpose**: The actual question text
- **Format**: Plain text or HTML-escaped characters
- **Constraints**: 
  - Minimum length: 10 characters
  - Maximum length: 1000 characters
- **Example**: `"依據 ISO 14064‑1:2018 標準，下列何者屬於..."`

#### `options` (object)
- **Purpose**: Answer choices for the question
- **Format**: Object with keys A-F
- **Constraints**:
  - Minimum 2 options
  - Maximum 6 options
  - Each option 1-500 characters
- **Example**:
```json
{
  "A": "Option text",
  "B": "Option text",
  "C": "Option text",
  "D": "Option text"
}
```

#### `answer` (string)
- **Purpose**: Correct answer key
- **Format**: Single character A-F
- **Constraints**: Must match one of the option keys
- **Example**: `"B"`

### Optional Fields

#### `explanation` (string)
- **Purpose**: Detailed explanation of the correct answer
- **Format**: Plain text or markdown
- **Use Case**: Displayed after user answers
- **Example**: `"根據ISO 14064-1:2018標準..."`

#### `category` (string)
- **Purpose**: Main topic category
- **Examples**: `"ISO Standards"`, `"Carbon Accounting"`, `"Renewable Energy"`

#### `subcategory` (string)
- **Purpose**: Specific topic within category
- **Examples**: `"ISO 14064-1"`, `"Scope 3 Emissions"`

#### `difficulty` (string)
- **Purpose**: Question difficulty level
- **Values**: `"easy"`, `"medium"`, `"hard"`, `"expert"`
- **Default**: `"medium"`

#### `references` (array)
- **Purpose**: Source materials for the question
- **Format**: Array of strings
- **Example**: `["ISO 14064-1:2018", "GHG Protocol"]`

#### `tags` (array)
- **Purpose**: Searchable keywords
- **Format**: Array of strings
- **Example**: `["ISO", "溫室氣體", "碳排放"]`

#### `weight` (number)
- **Purpose**: Question importance in scoring
- **Range**: 0.1 to 10
- **Default**: 1
- **Example**: `2` (counts double in scoring)

#### `timeLimit` (number)
- **Purpose**: Time limit for this question in seconds
- **Range**: 30 to 300
- **Default**: 60
- **Example**: `90`

#### `points` (number)
- **Purpose**: Point value for correct answer
- **Range**: 1 to 10
- **Default**: 1
- **Example**: `2`

#### `mediaUrl` (string | null)
- **Purpose**: URL to associated media (image, video)
- **Format**: Valid URL or null
- **Example**: `"https://example.com/diagram.png"`

#### `relatedQuestions` (array)
- **Purpose**: IDs of related questions
- **Format**: Array of question IDs
- **Example**: `["c1-002", "c1-003"]`

#### `metadata` (object)
- **Purpose**: Additional tracking information
- **Fields**:
  - `author`: Question creator
  - `createdAt`: ISO 8601 timestamp
  - `updatedAt`: ISO 8601 timestamp
  - `version`: Version string
  - `reviewedBy`: Reviewer name
  - `approvedBy`: Approver name

---

## Validation Rules

### JSON Schema Validation

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "array",
  "items": {
    "type": "object",
    "required": ["id", "subject", "question", "options", "answer"],
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^[a-zA-Z0-9-]+$",
        "minLength": 3,
        "maxLength": 50
      },
      "subject": {
        "type": "string",
        "minLength": 1,
        "maxLength": 200
      },
      "question": {
        "type": "string",
        "minLength": 10,
        "maxLength": 1000
      },
      "options": {
        "type": "object",
        "properties": {
          "A": { "type": "string", "minLength": 1, "maxLength": 500 },
          "B": { "type": "string", "minLength": 1, "maxLength": 500 },
          "C": { "type": "string", "minLength": 1, "maxLength": 500 },
          "D": { "type": "string", "minLength": 1, "maxLength": 500 },
          "E": { "type": "string", "minLength": 1, "maxLength": 500 },
          "F": { "type": "string", "minLength": 1, "maxLength": 500 }
        },
        "required": ["A", "B"],
        "additionalProperties": false
      },
      "answer": {
        "type": "string",
        "enum": ["A", "B", "C", "D", "E", "F"]
      },
      "explanation": {
        "type": "string",
        "maxLength": 2000
      },
      "difficulty": {
        "type": "string",
        "enum": ["easy", "medium", "hard", "expert"]
      },
      "weight": {
        "type": "number",
        "minimum": 0.1,
        "maximum": 10
      },
      "timeLimit": {
        "type": "integer",
        "minimum": 30,
        "maximum": 300
      },
      "points": {
        "type": "integer",
        "minimum": 1,
        "maximum": 10
      }
    }
  }
}
```

### Validation Script

```javascript
// scripts/validate-questions.js
const fs = require('fs')
const Ajv = require('ajv')

const schema = require('./question-schema.json')
const questions = require('../src/assets/questions.json')

const ajv = new Ajv()
const validate = ajv.compile(schema)

function validateQuestions() {
  const valid = validate(questions)
  
  if (!valid) {
    console.error('Validation errors:', validate.errors)
    process.exit(1)
  }
  
  // Additional custom validations
  const ids = new Set()
  
  questions.forEach((q, index) => {
    // Check for duplicate IDs
    if (ids.has(q.id)) {
      console.error(`Duplicate ID found: ${q.id} at index ${index}`)
      process.exit(1)
    }
    ids.add(q.id)
    
    // Verify answer exists in options
    if (!q.options[q.answer]) {
      console.error(`Invalid answer key for question ${q.id}`)
      process.exit(1)
    }
    
    // Check related questions exist
    if (q.relatedQuestions) {
      q.relatedQuestions.forEach(relId => {
        if (!questions.find(q => q.id === relId)) {
          console.warn(`Related question ${relId} not found for ${q.id}`)
        }
      })
    }
  })
  
  console.log(`✓ All ${questions.length} questions validated successfully`)
}

validateQuestions()
```

---

## Examples

### Basic Question

```json
{
  "id": "basic-001",
  "subject": "淨零基礎",
  "question": "什麼是淨零排放？",
  "options": {
    "A": "完全不排放溫室氣體",
    "B": "排放量與移除量達到平衡",
    "C": "只使用再生能源",
    "D": "減少50%的碳排放"
  },
  "answer": "B"
}
```

### Advanced Question with All Features

```json
{
  "id": "advanced-001",
  "subject": "考科二：溫室氣體盤查實務",
  "category": "GHG Inventory",
  "subcategory": "Calculation Methods",
  "difficulty": "hard",
  "question": "某製造業工廠使用天然氣作為燃料，月使用量為10,000立方公尺，天然氣的排放係數為2.16 kgCO2e/m³，該工廠本月的範疇一排放量為多少噸CO2e？",
  "options": {
    "A": "21.6 噸",
    "B": "216 噸",
    "C": "2,160 噸",
    "D": "21,600 噸"
  },
  "answer": "A",
  "explanation": "計算方式：10,000 m³ × 2.16 kgCO2e/m³ = 21,600 kgCO2e = 21.6 噸CO2e。這是典型的範疇一直接排放計算，使用活動數據乘以排放係數的方法。",
  "references": [
    "IPCC 2006 Guidelines",
    "環保署溫室氣體排放係數管理表6.0.4版"
  ],
  "tags": ["計算題", "範疇一", "天然氣", "排放係數"],
  "weight": 2,
  "timeLimit": 120,
  "points": 3,
  "relatedQuestions": ["advanced-002", "advanced-003"],
  "metadata": {
    "author": "Dr. Chen",
    "createdAt": "2025-07-15T08:00:00Z",
    "updatedAt": "2025-08-20T10:30:00Z",
    "version": "1.1.0",
    "reviewedBy": "Prof. Lin",
    "approvedBy": "iPAS Committee"
  }
}
```

### Multiple Choice with Images

```json
{
  "id": "visual-001",
  "subject": "再生能源系統",
  "question": "下圖顯示的是哪種再生能源發電系統？",
  "mediaUrl": "https://example.com/images/solar-panel.jpg",
  "options": {
    "A": "風力發電",
    "B": "太陽能光電",
    "C": "水力發電",
    "D": "地熱發電"
  },
  "answer": "B",
  "explanation": "圖片顯示的是太陽能光電板（Photovoltaic panels），這是最常見的太陽能發電系統。"
}
```

---

## Best Practices

### 1. Question Writing Guidelines

#### Clarity and Precision

```json
{
  "good": {
    "question": "根據ISO 14064-1:2018，範疇二排放包含下列何者？",
    "clear": true,
    "specific": true
  },
  "bad": {
    "question": "哪個是對的？",
    "clear": false,
    "specific": false
  }
}
```

#### Avoid Ambiguity

```json
{
  "good": {
    "options": {
      "A": "增加20%",
      "B": "減少20%",
      "C": "維持不變",
      "D": "無法判斷"
    }
  },
  "bad": {
    "options": {
      "A": "可能增加",
      "B": "可能減少",
      "C": "不一定",
      "D": "都有可能"
    }
  }
}
```

### 2. Content Organization

#### Consistent Subject Naming

```javascript
const subjects = {
  "exam1": "考科一：淨零碳規劃管理基礎概論",
  "exam2": "考科二：溫室氣體盤查實務",
  "exam3": "考科三：碳足跡計算與管理",
  "exam4": "考科四：淨零轉型策略規劃"
}
```

#### Logical ID Structure

```
Pattern: [exam]-[topic]-[number]

Examples:
- c1-iso-001    (考科一, ISO standards, #1)
- c2-ghg-015    (考科二, GHG inventory, #15)
- c3-lca-008    (考科三, Life cycle assessment, #8)
```

### 3. Difficulty Distribution

```javascript
const difficultyDistribution = {
  "easy": "20%",      // Basic concepts
  "medium": "50%",    // Standard knowledge
  "hard": "25%",      // Advanced application
  "expert": "5%"      // Expert level
}
```

### 4. Explanation Quality

```json
{
  "comprehensive": {
    "explanation": "根據ISO 14064-1:2018第5.2.2節，範疇二包含輸入能源的間接排放，特別是外購電力、蒸汽、熱能和冷卻。選項A的天然氣屬於範疇一直接排放，選項C和D屬於範疇三其他間接排放。",
    "includes": ["correct_reasoning", "why_others_wrong", "reference"]
  },
  "minimal": {
    "explanation": "B是正確答案。",
    "lacks": ["detail", "learning_value"]
  }
}
```

---

## Localization

### Multi-language Support

```json
{
  "id": "multi-lang-001",
  "translations": {
    "zh-TW": {
      "question": "什麼是碳中和？",
      "options": {
        "A": "零碳排放",
        "B": "碳排放與碳移除平衡"
      }
    },
    "en": {
      "question": "What is carbon neutrality?",
      "options": {
        "A": "Zero carbon emissions",
        "B": "Balance between emissions and removals"
      }
    }
  }
}
```

### Regional Variations

```json
{
  "id": "regional-001",
  "region": "TW",
  "question": "台灣2050淨零排放路徑的關鍵戰略有幾項？",
  "options": {
    "A": "4項",
    "B": "8項",
    "C": "12項",
    "D": "16項"
  },
  "answer": "C",
  "explanation": "台灣2050淨零排放路徑包含12項關鍵戰略。"
}
```

---

## Advanced Features

### 1. Conditional Questions

```json
{
  "id": "conditional-001",
  "question": "您的組織是否已完成溫室氣體盤查？",
  "options": {
    "A": "是",
    "B": "否"
  },
  "answer": "A",
  "conditionalNext": {
    "A": "followup-001",
    "B": "basic-001"
  }
}
```

### 2. Weighted Scoring

```javascript
// Calculate weighted score
function calculateWeightedScore(questions, answers) {
  let totalWeight = 0
  let weightedScore = 0
  
  questions.forEach(q => {
    const weight = q.weight || 1
    totalWeight += weight
    
    if (answers[q.id] === q.answer) {
      weightedScore += weight
    }
  })
  
  return (weightedScore / totalWeight) * 100
}
```

### 3. Question Pools

```json
{
  "pools": {
    "basic": {
      "questions": ["b001", "b002", "b003"],
      "select": 2
    },
    "intermediate": {
      "questions": ["i001", "i002", "i003", "i004"],
      "select": 3
    },
    "advanced": {
      "questions": ["a001", "a002"],
      "select": 1
    }
  },
  "totalQuestions": 6
}
```

### 4. Adaptive Testing

```javascript
// Adaptive difficulty adjustment
function getNextQuestion(performance) {
  if (performance.correctRate > 0.8) {
    return getQuestionByDifficulty('hard')
  } else if (performance.correctRate < 0.4) {
    return getQuestionByDifficulty('easy')
  } else {
    return getQuestionByDifficulty('medium')
  }
}
```

---

## Migration Guide

### From CSV to JSON

```javascript
// scripts/csv-to-json.js
const csv = require('csv-parser')
const fs = require('fs')

const questions = []

fs.createReadStream('questions.csv')
  .pipe(csv())
  .on('data', (row) => {
    questions.push({
      id: row.ID,
      subject: row.Subject,
      question: row.Question,
      options: {
        A: row.OptionA,
        B: row.OptionB,
        C: row.OptionC,
        D: row.OptionD
      },
      answer: row.Answer,
      explanation: row.Explanation
    })
  })
  .on('end', () => {
    fs.writeFileSync(
      'questions.json',
      JSON.stringify(questions, null, 2)
    )
    console.log('Migration complete')
  })
```

### From Excel to JSON

```javascript
// scripts/excel-to-json.js
const XLSX = require('xlsx')

function excelToJson(filePath) {
  const workbook = XLSX.readFile(filePath)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json(sheet)
  
  const questions = data.map((row, index) => ({
    id: `imported-${String(index + 1).padStart(3, '0')}`,
    subject: row['科目'] || row['Subject'],
    question: row['題目'] || row['Question'],
    options: {
      A: row['選項A'] || row['Option A'],
      B: row['選項B'] || row['Option B'],
      C: row['選項C'] || row['Option C'],
      D: row['選項D'] || row['Option D']
    },
    answer: row['答案'] || row['Answer'],
    explanation: row['解析'] || row['Explanation'] || ''
  }))
  
  return questions
}
```

### Version Migration

```javascript
// Migrate from v1 to v2 format
function migrateV1ToV2(oldQuestions) {
  return oldQuestions.map(q => ({
    ...q,
    // Add new required fields
    category: q.category || 'General',
    difficulty: q.difficulty || 'medium',
    weight: q.weight || 1,
    // Rename fields
    id: q.questionId || q.id,
    explanation: q.rationale || q.explanation,
    // Add metadata
    metadata: {
      version: '2.0.0',
      migrated: true,
      migratedAt: new Date().toISOString()
    }
  }))
}
```

---

## Appendix

### Question Import Template

```csv
ID,Subject,Question,OptionA,OptionB,OptionC,OptionD,Answer,Explanation,Category,Difficulty,Tags
c1-001,考科一,題目內容,選項A,選項B,選項C,選項D,A,解析說明,ISO Standards,medium,"ISO,碳排放"
```

### Batch Operations

```javascript
// Batch update questions
function batchUpdate(updates) {
  const questions = require('./questions.json')
  
  updates.forEach(update => {
    const index = questions.findIndex(q => q.id === update.id)
    if (index !== -1) {
      questions[index] = { ...questions[index], ...update.changes }
    }
  })
  
  fs.writeFileSync(
    './questions.json',
    JSON.stringify(questions, null, 2)
  )
}

// Usage
batchUpdate([
  { id: 'c1-001', changes: { difficulty: 'hard' } },
  { id: 'c1-002', changes: { timeLimit: 120 } }
])
```

### Quality Checklist

- [ ] All questions have unique IDs
- [ ] Question text is clear and unambiguous
- [ ] Options are mutually exclusive
- [ ] Correct answer is verified
- [ ] Explanations provide learning value
- [ ] Difficulty levels are appropriate
- [ ] Categories are consistent
- [ ] No spelling or grammar errors
- [ ] References are accurate
- [ ] Metadata is complete

---

*Last Updated: 2025-08-21*

*For question content support, contact the curriculum team.*