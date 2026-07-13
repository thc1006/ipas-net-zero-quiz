# 淨零碳規劃管理師備考神器 | iPAS 淨零碳規劃管理師考古題

[![Deploy Quiz App to GitHub Pages](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-deploy.yml/badge.svg)](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-deploy.yml)
[![Quiz App CI](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-ci.yml/badge.svg?branch=main)](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-ci.yml)
[![codecov](https://codecov.io/gh/thc1006/ipas-net-zero-quiz/branch/main/graph/badge.svg)](https://codecov.io/gh/thc1006/ipas-net-zero-quiz)

線上測驗：**<https://thc1006.github.io/ipas-net-zero-quiz/>**

## 題庫

| | 題數 | 說明 |
| --- | ---: | --- |
| **主題庫** | **780 題** | 考科一 434 + 考科二 346。其中 159 題由來源 PDF 分欄重建 |
| **加強練習池**（選用） | **157 題** | 55 題公開模擬題 + 102 題 AI 產題。**預設關閉**，需於設定頁 opt-in |

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

## 這份題庫可不可信

我們把「可不可信」做成**可以自己驗證的東西**，而不是一句宣稱 ——
**包括老實說出哪些地方還做不到：**

- **有來源的題目，來源是查得到的** —— 主題庫 **346 / 780 題**（44%）在 `metadata.sources`
  附一手來源 URL（環境部、EUR-Lex、IPCC、ISO、法規資料庫等，51 條 distinct）。
  這些 URL 由季排程 workflow 每季自動檢查是否還通。
  ⚠️ **其餘 434 題沒有來源連結** —— 它們來自社群共筆的考古題整理，我們沒有為每一題補上出處。
- **重建的題目有證據鏈** —— 159 題逐題記錄來自哪一份 PDF（含 sha256）的哪一頁、哪一欄、
  第幾題，以及 PDF 自己印的 answer key。跑 `python tools/restore_from_source_pdf.py --verify`
  可完整重現（實測 **159/159** 相符）
- **改過的答案留得下痕跡** —— 13 題答案曾被更正，每題都保留 `metadata.prior_answer`
  與 `_correction_note`（改了什麼、憑什麼改）。其中 10 題附一手來源 URL，
  另外 3 題的依據是標準條文本身（見該題的 `_correction_note`）。
  推翻來源 PDF 的答案卡需要列明依據，而且 CI 會擋下沒有依據的偏離。
- **AI 產題與人工整理的題目嚴格隔離** —— AI 產題不會混進主題庫，UI 也會標示
- **文件不能對資料說謊** —— README、網站文案、`llms.txt`、甚至 GitHub 的 About，
  上面每個題數都由 CI 對著資料實算比對，對不上就擋下 merge

> **欄位名稱**：主題庫用 `metadata.sources`；加強練習池才用 `sources` / `provenance`。
> 兩者 schema 不同，不要混用。

📎 證據鏈、還原方法、CI gate 如何驗證上述宣稱 → [`DATA-PROVENANCE.md`](DATA-PROVENANCE.md)

## 免責

本工具為非官方 iPAS 備考輔助，題庫整理可能含錯誤，最終以 iPAS 官方公告為準。
本專案不就內容正確性、可考性、或考試結果提供任何保證。
（iPAS 不公開歷屆試題，本題庫整理自公開資料與社群共筆。）

## 內容時效性

題庫中有 **112 題**的答案會隨法規變動（CBAM、碳費、NDC、碳中和標準）。
[`CONTENT-CURRENCY.md`](CONTENT-CURRENCY.md) 記錄已查證到哪一天、**還有什麼沒確定**、
以及下一個到期日（最近的是 **2026-12-15：ISAE 3410 撤回，由 ISSA 5000 取代**）。

⚠️ `meta.content_review.last_review_date` **不代表整份題庫都查證到那一天** ——
本輪只實查 **100 / 780** 題。判斷單一題目請看該題的 `metadata.valid_as_of`。

⚠️ `quarterly-time-sensitive-verify` workflow **只驗連結還通不通，驗不出內容變了**
—— 綠燈不等於內容正確。
（CBAM 憑證繳交期限 5/31 → 9/30、臺灣 2030 NDC 24%±1% → 28%±2%，網址全程都是活的。）

## 開發

需要 Node.js ≥ 20 與 pnpm ≥ 9。

```bash
corepack enable && pnpm install

pnpm dev            # 開發（含 schema fail-fast 驗證）
pnpm build          # 建置
pnpm test:run       # 單元測試（vitest）
pnpm test:e2e       # E2E（playwright）
pnpm lint && pnpm type-check
```

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
