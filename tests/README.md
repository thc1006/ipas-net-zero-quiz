# iPAS Net Zero Quiz - 測試文件

## 測試架構概述

本專案採用全面的測試策略，包括單元測試、整合測試和邊界情況測試，確保應用程式的穩定性和可靠性。

## 技術棧

- **測試框架**: Vitest
- **Vue 測試工具**: Vue Test Utils
- **測試環境**: jsdom
- **覆蓋率工具**: @vitest/coverage-v8
- **模擬工具**: Vitest 內建 mocking

## 測試結構

```
tests/
├── setup.js                    # 全域測試設定
├── fixtures/                   # 測試資料
│   └── testQuestions.js        # 模擬題目資料
├── utils/                      # 測試工具
│   └── testHelpers.js          # 測試輔助函數
├── components/                 # 組件測試
│   ├── QuizView.test.js        # QuizView 主要功能測試
│   └── QuizView.edge-cases.test.js  # 邊界情況測試
├── composables/               # Composable 測試
│   └── useQuiz.test.js        # useQuiz 功能測試
└── integration/               # 整合測試
    └── quiz-flow.test.js      # 完整測驗流程測試
```

## 測試類別

### 1. 單元測試 (Unit Tests)

#### QuizView.vue 組件測試
- **初始化狀態測試**: 驗證組件載入時的預設狀態
- **答案選擇測試**: 測試答案選擇邏輯和狀態更新
- **題目導航測試**: 驗證前進/後退題目功能
- **測驗完成測試**: 檢查完成狀態和結果顯示
- **重新開始測試**: 驗證重置功能
- **計算屬性測試**: 測試響應式計算邏輯
- **方法測試**: 驗證核心方法的正確性

#### useQuiz Composable 測試
- **初始化測試**: Composable 初始狀態
- **題目導航**: 導航邏輯和狀態管理
- **答題功能**: 答案記錄和分數計算
- **計時器功能**: 時間管理和自動前進
- **統計功能**: 答題統計和準確率計算
- **資料持久化**: localStorage 存取功能
- **測驗流程控制**: 開始、完成、重置流程
- **題目配置**: 打亂題目和選項功能
- **鍵盤操作**: 鍵盤快捷鍵支援
- **結果分析**: 詳細結果報告生成

### 2. 邊界情況測試 (Edge Cases)

- **空題目列表**: 處理無題目的情況
- **單一題目**: 只有一題的特殊情況
- **無效題目資料**: 處理格式錯誤的題目
- **極端分數**: 滿分和零分情況
- **操作安全性**: 防止無效操作
- **記憶體洩漏防護**: 組件生命週期管理
- **大量資料處理**: 效能和穩定性測試

### 3. 整合測試 (Integration Tests)

- **完整測驗流程**: 從開始到完成的完整操作
- **混合答案情況**: 正確和錯誤答案的組合
- **重新開始功能**: 完整的重置流程
- **UI 狀態同步**: 介面與狀態的一致性
- **錯誤處理**: 異常情況的正確處理
- **可訪問性**: 無障礙功能和用戶體驗

## 測試指令

### 基本指令

```bash
# 執行所有測試
npm run test

# 執行測試並產生覆蓋率報告
npm run test:coverage

# 執行測試並監看檔案變化
npm run test:watch

# 執行測試一次並退出
npm run test:run

# 開啟測試 UI 界面
npm run test:ui
```

### 分類測試指令

```bash
# 執行組件測試
npm run test:components

# 執行整合測試
npm run test:integration

# 執行邊界情況測試
npm run test:edge-cases

# 執行 Composable 測試
npm run test:composables
```

## 覆蓋率要求

專案設定了以下覆蓋率門檻：

- **分支覆蓋率**: 80%
- **函數覆蓋率**: 80%
- **行覆蓋率**: 80%
- **語句覆蓋率**: 80%

## 測試最佳實踐

### 1. 測試命名規範

```javascript
describe('QuizView.vue', () => {
  describe('初始化狀態測試', () => {
    it('應該正確載入題目資料', () => {
      // 測試內容
    })
  })
})
```

### 2. 測試組織

- 使用 `describe` 區塊組織相關測試
- 使用中文描述測試情境和期望
- 一個 `it` 區塊只測試一個特定行為

### 3. 測試資料

- 使用 `fixtures` 目錄存放測試資料
- 建立可重用的模擬資料
- 避免在測試中直接使用真實資料

### 4. 測試輔助工具

- 使用 `testHelpers.js` 中的輔助函數
- 抽象化常見的測試模式
- 提高測試的可讀性和維護性

## 持續整合

測試整合在 CI/CD 流程中：

1. **程式碼提交**: 自動執行所有測試
2. **覆蓋率檢查**: 確保達到覆蓋率門檻
3. **測試報告**: 生成詳細的測試報告
4. **失敗通知**: 測試失敗時發送通知

## 除錯指南

### 常見問題

1. **組件未正確掛載**
   ```javascript
   // 確保正確 mock 依賴
   vi.mock('../../src/assets/questions.json', () => ({
     default: mockQuestions
   }))
   ```

2. **非同步操作未等待**
   ```javascript
   // 使用 await 等待非同步操作
   await wrapper.vm.$nextTick()
   await wrapper.find('.button').trigger('click')
   ```

3. **Mock 未正確設定**
   ```javascript
   // 在 beforeEach 中重置 mock
   beforeEach(() => {
     vi.clearAllMocks()
   })
   ```

### 測試除錯技巧

1. **使用 console.log** 查看元件狀態
2. **檢查 wrapper.html()** 查看渲染結果
3. **使用 wrapper.vm** 直接存取元件實例
4. **利用 Vitest UI** 進行視覺化除錯

## 效能注意事項

1. **避免不必要的元件掛載**
2. **正確清理測試環境**
3. **使用 fake timers 控制時間相關測試**
4. **批次執行相關測試**

## 貢獻指南

新增測試時請遵循：

1. **遵循現有的測試結構**
2. **使用中文撰寫測試描述**
3. **確保測試的獨立性**
4. **更新相關文件**
5. **維持覆蓋率門檻**

## 相關資源

- [Vitest 官方文件](https://vitest.dev/)
- [Vue Test Utils 官方文件](https://test-utils.vuejs.org/)
- [Vue 3 測試指南](https://vuejs.org/guide/scaling-up/testing.html)
- [測試最佳實踐](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)