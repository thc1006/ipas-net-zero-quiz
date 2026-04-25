# 淨零碳備考神器 | iPAS 淨零碳規劃管理師考古題

[![Deploy Quiz App to GitHub Pages](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-deploy.yml/badge.svg)](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-deploy.yml)
[![Quiz App CI](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-ci.yml/badge.svg?branch=main)](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-ci.yml)
[![codecov](https://codecov.io/gh/thc1006/ipas-net-zero-quiz/branch/main/graph/badge.svg)](https://codecov.io/gh/thc1006/ipas-net-zero-quiz)

線上測驗：**https://thc1006.github.io/ipas-net-zero-quiz/**

## 功能特色

- **648 題主題庫**：涵蓋考科一（淨零碳規劃管理基礎）與考科二（碳盤查範圍與程序）
- **加強練習池（選用）**：開啟後額外提供 151 題補充題（55 題公開模擬題 + 96 題 AI 產題），每題附來源徽章
- **練習/考試模式**：即時答案反饋或最後顯示結果
- **參考來源連結**：每題答題後顯示權威引證（環境部、EUR-Lex、IPCC、ISO 等），URL 全部 curl 實測通過
- **AI 解析**：透過 Puter.js 呼叫 OpenAI GPT-5.4 提供題目分析（無需 API key 設定）
- **無障礙支援**：高對比度、CVD 色覺辨認模式、可調字體大小、深色模式
- **EU AI Act 合規**：AI 產題依 Art.50（2026-08-02 起）規範揭露，UI 顯示警示徽章
- **成績匯出**：匯出測驗結果與錯題記錄

## 加強練習池

額外的 151 題補充題庫，**獨立於主題庫**，使用者於設定頁明確 opt-in 才啟用：

| 來源 | 題數 | 說明 |
|---|---|---|
| `external_mock` | 55 | 取自 vocus 講師、HackMD、yamol 等公開模擬題（非官方歷屆，iPAS 不公開歷屆）|
| `ai_generated` | 96 | 由 LLM 代理依 ISO/CBAM/環境部等法規與標準產生，每題經獨立驗證代理 cross-check 通過，並附 ≥1 條 primary-source URL（law.moj.gov.tw、EUR-Lex、IPCC、ISO 等，curl 實測可達）|

每題顯示來源徽章（「模擬題」/「AI 產題」），AI 產題用警示色 + 邊框與 quality_flags（時效性 / 爭議 / 低信心）chips。資料 schema 在啟動時於 dev 模式 fail-fast 驗證。

## 考科範圍

### 考科一：淨零碳規劃管理基礎概論
- 淨零排放國際發展與政策趨勢、CBAM、Paris Article 6
- 永續發展與碳中和目標、PAS 2060 / ISO 14068-1
- 溫室氣體基礎知識、IPCC GWP（AR5/AR6）
- 碳管理策略與工具、SBTi、ISSB IFRS S1/S2

### 考科二：淨零碳盤查範圍與程序概要
- ISO 14064-1:2018 六分類（Cat 1–6）盤查範疇
- 組織碳盤查邊界（營運／財務／股權控制法）
- 排放係數與計算方法、AR5 GWP（環境部 113/2/5 公告）
- 碳盤查報告與查證、CFP-PCR、產品碳足跡

## 開發

### 環境需求
- Node.js >= 20.0.0
- pnpm >= 9.0.0（CI 自動以 `npm install -g corepack@latest` 升級 Corepack 解 [#612](https://github.com/nodejs/corepack/issues/612) 簽名問題）

### 安裝與執行

```bash
# 啟用 Corepack（自動管理 pnpm 版本）
corepack enable

# 安裝依賴
pnpm install

# 開發模式（含 schema validators dev fail-fast）
pnpm dev

# 建置
pnpm build

# 預覽建置結果
pnpm preview

# 執行測試（vitest）
pnpm test:run

# 含 coverage
pnpm test:coverage

# E2E 測試（playwright）
pnpm test:e2e

# Lint + Type check
pnpm lint && pnpm type-check
```

## Stack

- **框架**：React 18 + TypeScript（嚴格模式）
- **建置工具**：Vite 6（含 dynamic import code-splitting）
- **測試**：Vitest + @testing-library/react + Playwright
- **CI**：GitHub Actions（lint + tsc + test + build + e2e + CodeQL + Codecov）
- **AI**：Puter.js + OpenAI GPT-5.4
- **訪客計數**：Abacus（jasoncameron.dev）+ counterapi.dev fallback
- **部署**：GitHub Pages（push to main 自動部署）

## 資料品質政策

- 每個答案修正都附 curl 實測通過的 primary-source URL
- AI 產題嚴格隔離於 `ai_generated` source_type，不混入主題庫
- 每題支援 `metadata.sources_verified_date` 與 `provenance.verify_verdict` 審計欄位
- Schema validator 於 dev 模式啟動時自動驗證主題庫與練習池

## 授權

本工具僅供練習參考；題庫資料為個人整理，非官方發布。

## 問題回報

如有任何問題或建議，請至 [Discussions #1](https://github.com/thc1006/ipas-net-zero-quiz/discussions/1) 回報。
