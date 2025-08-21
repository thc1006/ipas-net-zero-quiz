// 測試用的模擬題目資料
export const mockQuestions = [
  {
    id: "test-001",
    subject: "測試科目",
    question: "這是第一個測試題目？",
    options: {
      A: "選項A",
      B: "選項B", 
      C: "選項C",
      D: "選項D"
    },
    answer: "A",
    explanation: "這是第一題的解釋"
  },
  {
    id: "test-002", 
    subject: "測試科目",
    question: "這是第二個測試題目？",
    options: {
      A: "第二題選項A",
      B: "第二題選項B",
      C: "第二題選項C", 
      D: "第二題選項D"
    },
    answer: "C",
    explanation: "這是第二題的解釋"
  },
  {
    id: "test-003",
    subject: "測試科目", 
    question: "這是第三個測試題目？",
    options: {
      A: "第三題選項A",
      B: "第三題選項B",
      C: "第三題選項C",
      D: "第三題選項D"
    },
    answer: "B",
    explanation: "這是第三題的解釋"
  }
]

// 空題目測試資料
export const emptyQuestions = []

// 無效題目測試資料
export const invalidQuestions = [
  {
    // 缺少必要欄位
    id: "invalid-001",
    question: "無效題目1"
    // 缺少 options 和 answer
  },
  {
    id: "invalid-002",
    question: "無效題目2",
    options: {
      A: "選項A"
      // 缺少其他選項
    },
    answer: "B" // 答案不在選項中
  },
  {
    // 題目為空字串
    id: "invalid-003",
    question: "",
    options: {
      A: "選項A",
      B: "選項B"
    },
    answer: "A"
  }
]

// 單一題目測試資料
export const singleQuestion = [mockQuestions[0]]