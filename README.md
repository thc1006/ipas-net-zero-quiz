# 淨零碳規劃管理師備考神器 | iPAS 淨零碳規劃管理師考古題

[![Deploy Quiz App to GitHub Pages](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-deploy.yml/badge.svg)](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-deploy.yml)
[![Quiz App CI](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-ci.yml/badge.svg?branch=main)](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-ci.yml)
[![codecov](https://codecov.io/gh/thc1006/ipas-net-zero-quiz/branch/main/graph/badge.svg)](https://codecov.io/gh/thc1006/ipas-net-zero-quiz)

線上測驗：**<https://thc1006.github.io/ipas-net-zero-quiz/>**

## 題庫

| | 題數 | 說明 |
| --- | ---: | --- |
| **主題庫** | **781 題** | 考科一 439 + 考科二 342。其中 159 題由來源 PDF 分欄重建 |
| **加強練習池**（選用） | **154 題** | 54 題公開模擬題 + 100 題 AI 產題。**預設關閉**，需於設定頁 opt-in |

考科歸屬依官方「iPAS 能力鑑定簡章」§2.5 評鑑內容（`L11` / `L12`）劃分：
CBAM、ISO 14068-1 屬**科目一**；**科目二只涵蓋 ISO 14064-1 與 ISO 14067**。

## 考科範圍

### 考科一：淨零碳規劃管理基礎概論

- 淨零排放國際發展與政策趨勢、**CBAM**、Paris Article 6
- 永續發展與碳中和目標、**PAS 2060 / ISO 14068-1**
- 溫室氣體基礎知識、IPCC GWP（AR5 / AR6）
- 碳管理策略與工具、SBTi、ISSB **IFRS S1/S2**

### 考科二：淨零碳盤查規範與程序概要

- **ISO 14064-1:2018** 六分類（Cat 1–6）盤查範疇
- 組織碳盤查邊界（營運／財務／股權控制法）
- 排放係數與計算方法、AR5 GWP（環境部 113/2/5 公告）
- 碳盤查報告與查證、**CFP-PCR**、產品碳足跡（ISO 14067）

## 功能

- **練習 / 考試**兩種模式，可依考科與題數出卷
- **AI 解析**（Puter.js，免 API key）
- **無障礙**：高對比、色覺辨認（CVD）模式、字級調整、深色模式
- 成績與錯題**匯出**
- AI 產題依 **EU AI Act Art.50**（2026-08-02 起）揭露，UI 顯示警示徽章

## 資料品質

每一題都留下「憑什麼這樣答」的痕跡，也留下**做不到的地方**：

- **先講最重要的一件事**：「引用被驗過」**不等於**「答案是對的」。
  機械檢查只能證明那句話真的在那一頁上，證不了那句話撐得住這個答案。
- 來源分三級計算（逐字引文／一手來源 URL／完全沒有來源），不混為一談。
- AI 產題與人工整理的題目嚴格隔離，UI 標示，並依 EU AI Act Art.50 揭露。
- **文件不能對資料說謊**：README、網站文案、`llms.txt`、GitHub About 上的每一個數字
  都由 CI 對帳，對不上就紅。

完整的證據鏈、每一輪複核的量化結果與已知缺口：

| 文件 | 內容 |
| --- | --- |
| [`DATA-PROVENANCE.md`](DATA-PROVENANCE.md) | 資料從哪來、憑什麼相信，以及逐輪稽核的數字 |
| [`CONTENT-CURRENCY.md`](CONTENT-CURRENCY.md) | 查證到哪一天、還有什麼沒確定、下一個到期日 |
| [`VERIFICATION-GAPS.md`](VERIFICATION-GAPS.md) | 還沒釘住依據的題目（自動產生，不要手改） |
| [`NEEDS-SOURCING.md`](NEEDS-SOURCING.md) | 缺來源的題目 |

## 換成你自己的題庫

引擎與內容是分開的：

1. **題庫格式**由 [`schemas/`](schemas/) 的 JSON Schema（draft 2020-12）定義 ——
   讓你的資料通過 `main-bank.schema.json` 與 `practice-pool.schema.json` 即可。
   為什麼不用 QTI／GIFT，理由寫在 [`schemas/README.md`](schemas/README.md)。
2. **平台名稱、網址、SEO 文案**集中在 [`platform.config.json`](platform.config.json)，改一個檔。
3. **考科代碼**在 schema 的 `$defs/examSubject`（目前是二科制）。

4. **語料輪廓**（題數、分布、答案洩漏指標）由 `src/data/content-profile.test.ts` 以
   Vitest snapshot 記錄。換題庫後執行 `pnpm test:run -u` 重新產生即可。
   那份測試裡也列出「只准往好的方向走、必須人工重設」的門檻清單（棘輪不放進 snapshot ——
   snapshot 的語意是「變了就更新」，會讓退步被一句 `-u` 抹掉）。

## 免責

本工具為非官方 iPAS 備考輔助，題庫整理可能含錯誤，最終以 iPAS 官方公告為準。
本專案不就內容正確性、可考性、或考試結果提供任何保證。
（iPAS 不公開歷屆試題，本題庫整理自公開資料與社群共筆。）

## 內容時效性

題庫中有 **132 題**的答案會隨法規變動（CBAM、碳費、NDC、碳中和標準）。
[`CONTENT-CURRENCY.md`](CONTENT-CURRENCY.md) 記錄已查證到哪一天、**還有什麼沒確定**、
以及下一個到期日（最近的是 **2026-12-15：ISAE 3410 撤回，由 ISSA 5000 取代**）。

`meta.content_review.last_review_date` **不代表整份題庫都查證到那一天** ——
本輪只實查 **132 / 781** 題。判斷單一題目請看該題的 `metadata.valid_as_of`。

季排程 `quarterly-time-sensitive-verify` 現在做兩件事，但**能力範圍差很多**：

| | 涵蓋範圍 | 偵測得到「內容變了」嗎 |
| --- | --- | --- |
| 連結健康檢查 | 所有 time_sensitive 題目的來源 URL | **不行**，只看 HTTP 狀態碼 |
| 法條原文釘選比對 | **只有** `law-articles.pinned.json` 裡那 6 部我國法規 | 可以，法條一改 sha256 就對不上 |

**所以綠燈仍然不等於內容正確。** 釘選只涵蓋 6 部我國法規；
**EU 法規、ISO 標準、SBTi/CDP 準則的內容變動，目前仍然沒有任何自動機制看得到。**
（CBAM 憑證繳交期限 5/31 → 9/30、臺灣 2030 NDC 24%±1% → 28%±2% —— 網址全程都是活的。）

## 開發

需要 Node.js ≥ 20 與 pnpm ≥ 9。

```bash
corepack enable && pnpm install

pnpm dev            # 開發（含 schema fail-fast 驗證）
pnpm build          # 建置
pnpm preview        # 預覽建置結果
pnpm test:run       # 單元測試（vitest）
pnpm test:coverage  # 含 coverage
pnpm test:e2e       # E2E（playwright）
pnpm lint && pnpm type-check
```

> CI 會先跑 `npm install -g corepack@latest` —— Node 20.18 內建的 Corepack 簽名公鑰
> 已過期（[nodejs/corepack#612](https://github.com/nodejs/corepack/issues/612)），
> 不升級會裝不動 pnpm。本機遇到同樣問題時也照做。

**技術棧**：React 18 + TypeScript（strict）／Vite 6／Vitest + Testing Library + Playwright／
GitHub Actions（lint · tsc · test · build · e2e · CodeQL · Codecov）／GitHub Pages 自動部署。

## 授權

雙授權：

- **原始碼** —— `AGPL-3.0-or-later`（見 [`LICENSE`](LICENSE)）
- **本專案自製的題庫、解析與內容** —— `CC-BY-SA-4.0`
- **引用之官方／第三方資料**（iPAS 公開考古題、法規條文、ISO／IPCC／EUR-Lex／環境部等）
  —— 依其各自原始條款，本專案**不主張著作權、不重新授權**；有出處的題目保留來源欄位
  （主題庫 `metadata.sources`、練習池 `sources` / `provenance`）

> **AGPL §13**：若您修改本專案後**以網路服務形式提供**（SaaS／公開網頁／API），
> 必須讓所有使用者能取得**對應修改版的完整原始碼**，授權同樣為 AGPL-3.0-or-later。

## 回報問題

發現錯題或有建議，請至 [Discussions #1](https://github.com/thc1006/ipas-net-zero-quiz/discussions/1)。
