# 淨零碳備考神器 | iPAS 淨零碳規劃管理師考古題

[![Deploy Quiz App to GitHub Pages](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-deploy.yml/badge.svg)](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-deploy.yml)

線上測驗：**https://thc1006.github.io/ipas-net-zero-quiz/**

## 功能特色

- **719 題考古題**：涵蓋考科一和考科二
- **練習/考試模式**：即時答案反饋或最後顯示結果
- **深色模式**：保護眼睛，適合夜間使用
- **無障礙支援**：高對比度、CVD 色覺辨認模式、可調字體大小
- **成績匯出**：匯出測驗結果和錯題記錄
- **AI 輔助**：題目解析和相似題目生成（使用 Gemini）

## 考科範圍

### 考科一：淨零碳規劃管理基礎概論
- 淨零排放國際發展與政策趨勢
- 永續發展與碳中和目標
- 溫室氣體基礎知識
- 碳管理策略與工具

### 考科二：淨零碳盤查範圍與程序概要
- ISO 14064 溫室氣體盤查標準
- 組織碳盤查範疇與邊界
- 排放係數與計算方法
- 碳盤查報告與查證

## 開發

### 環境需求

- Node.js >= 20.0.0
- pnpm >= 9.0.0（推薦使用 Corepack）

### 安裝與執行

```bash
# 啟用 Corepack（自動管理 pnpm 版本）
corepack enable

# 安裝依賴
pnpm install

# 開發模式
pnpm dev

# 建置
pnpm build

# 預覽建置結果
pnpm preview

# 執行測試
pnpm test

# E2E 測試
pnpm test:e2e
```

## Stack

- **框架**：React 18 + TypeScript
- **建置工具**：Vite 6
- **測試**：Vitest + Playwright
- **部署**：GitHub Pages

## 授權

本工具僅供練習參考。

## 問題回報

如有任何問題或建議，請至 [Discussions](https://github.com/thc1006/ipas-net-zero-quiz/discussions/1) 回報。
