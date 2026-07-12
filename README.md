# 淨零碳規劃管理師備考神器 | iPAS 淨零碳規劃管理師考古題

[![Deploy Quiz App to GitHub Pages](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-deploy.yml/badge.svg)](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-deploy.yml)
[![Quiz App CI](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-ci.yml/badge.svg?branch=main)](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-ci.yml)
[![codecov](https://codecov.io/gh/thc1006/ipas-net-zero-quiz/branch/main/graph/badge.svg)](https://codecov.io/gh/thc1006/ipas-net-zero-quiz)

線上測驗：**https://thc1006.github.io/ipas-net-zero-quiz/**

## 功能特色

- **799 題主題庫**：涵蓋考科一（淨零碳規劃管理基礎）與考科二（碳盤查範圍與程序）
- **加強練習池（選用）**：開啟後額外提供 157 題補充題（55 題公開模擬題 + 102 題 AI 產題），每題附來源徽章
- **練習/考試模式**：即時答案反饋或最後顯示結果
- **參考來源連結**：每題答題後顯示權威引證（環境部、EUR-Lex、IPCC、ISO 等），URL 全部 curl 實測通過
- **AI 解析**：透過 Puter.js 呼叫 OpenAI GPT-5.4 提供題目分析（無需 API key 設定）
- **無障礙支援**：高對比度、CVD 色覺辨認模式、可調字體大小、深色模式
- **EU AI Act 合規**：AI 產題依 Art.50（2026-08-02 起）規範揭露，UI 顯示警示徽章
- **成績匯出**：匯出測驗結果與錯題記錄

## 加強練習池

額外的 157 題補充題庫，**獨立於主題庫**，使用者於設定頁明確 opt-in 才啟用：

| 來源 | 題數 | 說明 |
|---|---|---|
| `external_mock` | 55 | 取自網路公開之模擬題（非官方歷屆，iPAS 不公開歷屆）|
| `ai_generated` | 102 | 由 LLM 代理依 ISO/CBAM/環境部/IFRS Foundation/IAASB 等法規與標準產生，每題經獨立驗證代理 cross-check 通過，並附 ≥1 條 primary-source URL（law.moj.gov.tw、EUR-Lex、IPCC、ISO、ifrs.org、iaasb.org 等，curl 實測可達）|

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

### Time-sensitive 題目維護

帶 `quality_flags: ["time_sensitive"]` 的題目（如 `pool-aig-industry_round1_rescued-ind-014` RE100 台灣會員）內容會隨時間變動，建議每季 re-verify：

```bash
# 列出所有 time_sensitive 題目
jq '.items[] | select(.quality_flags | index("time_sensitive")) | {id, stem: (.stem | .[0:60]), sources}' \
  quiz-app/src/data/practice_pool.json
```

維護動作：
1. 對每筆 source URL 跑 `curl -sIL --max-time 10 -A "Mozilla/5.0" <url>` 確認 200 OK
2. 比對最新內容跟題目選項是否仍一致
3. 不一致時：更新 `provenance.verified_date` + 修正答案（並照 commit policy 附 source URL）
4. 若 source 已失效：移除題目（同時更新 `_meta.totals` 與 `practice-pool-counts.ts`）

#### 自動季度 verify (GitHub Action)

`.github/workflows/quarterly-time-sensitive-verify.yml` 每季 1/1, 4/1, 7/1, 10/1 04:00 UTC 自動跑：jq 抓 `time_sensitive` 題目 → curl 每條 URL → 失敗自動開 / 更新 issue。也可手動觸發：`gh workflow run quarterly-time-sensitive-verify.yml`。

需在 repo Settings → Actions → General → Workflow permissions 啟用 **Read and write permissions**（否則 workflow 無法開 issue）。

## 授權

本專案採雙重授權架構：

- **原始碼**：GNU Affero General Public License v3.0 或更新版本（SPDX：`AGPL-3.0-or-later`）。完整條款見根目錄 [`LICENSE`](LICENSE) 與 [`LICENSES/AGPL-3.0-or-later.txt`](LICENSES/AGPL-3.0-or-later.txt)。
- **本專案自製之題庫、解析與內容資料**：Creative Commons Attribution-ShareAlike 4.0 International（SPDX：`CC-BY-SA-4.0`），除個別檔案另有標示者外，請見 [`LICENSES/CC-BY-SA-4.0.txt`](LICENSES/CC-BY-SA-4.0.txt)。
- **第三方／官方／公開來源資料**（例如 iPAS 公開考古題、法規條文、ISO/IPCC/EUR-Lex/環境部等引用內容、外部 URL、公開模擬題）：仍依其各自原始來源條款使用，本專案僅在合理引用、註明出處範圍內提供連結與摘錄，**不主張著作權、不重新授權**。每題保留 `sources` / `provenance` 等出處欄位。
- **第三方相依套件**：依其各自授權條款（見 `quiz-app/package.json` 與 lockfile）。

### AGPL 網路服務條款（重點）

若您修改本專案原始碼後**以網路服務（SaaS／公開網頁／API）形式提供給使用者**，依 AGPL-3.0 第 13 條，您必須讓所有與您修改版本互動的使用者，能取得**對應修改版的完整原始碼**，授權同樣為 AGPL-3.0-or-later。僅內部使用而未對外提供服務者，不觸發此條款，但仍受 AGPL 其他條款拘束。

### 免責

本工具為非官方 iPAS 備考輔助，題庫整理可能含錯誤，最終以 iPAS 官方公告為準。本專案不就內容正確性、可考性、或考試結果提供任何保證。

### 內容時效性

題庫中有 115 題的答案會隨法規變動（CBAM、碳費、NDC、碳中和標準）。
[`CONTENT-CURRENCY.md`](CONTENT-CURRENCY.md) 記錄已查證到哪一天、**還有什麼沒確定**、以及下一個到期日
（最近的是 **2026-12-15：ISAE 3410 撤回，由 ISSA 5000 取代**）。

⚠️ `meta.content_review.last_review_date` **不代表整份題庫都查證到那一天** —— 本輪只實查 103/783 題。
判斷單一題目請看該題的 `metadata.valid_as_of`。

⚠️ `quarterly-time-sensitive-verify` workflow **只驗連結還通不通，驗不出內容變了** —— 綠燈不等於內容正確。

### 還原題的可重現性

主題庫中有 159 題是從來源 PDF 重建的（2026-01-23 的清理把雙欄錯置的題目直接刪掉，
而非修復）。[`restoration-manifest.json`](quiz-app/src/data/restoration-manifest.json)
記錄每一題來自哪一份 PDF（含 **sha256**）的**哪一頁、哪一欄、第幾題**，以及 PDF 自己印的 **answer key**。

```bash
# CI 不下載 PDF：只驗 manifest ↔ dataset 一致（防竄改），離線秒級。
pnpm vitest run src/data/restoration-manifest.test.ts

# 完整重現（人工）：重新下載 PDF、比對 sha256、重跑分欄擷取、逐題核對。
pip install pdfplumber
python tools/restore_from_source_pdf.py --verify
```

實測 **159/159** 相符（頁碼／欄位／題號／answer key／PDF 文字 hash／repo 文字 hash）。

## 問題回報

如有任何問題或建議，請至 [Discussions #1](https://github.com/thc1006/ipas-net-zero-quiz/discussions/1) 回報。
