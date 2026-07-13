# 淨零碳規劃管理師備考神器 | iPAS 淨零碳規劃管理師考古題

[![Deploy Quiz App to GitHub Pages](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-deploy.yml/badge.svg)](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-deploy.yml)
[![Quiz App CI](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-ci.yml/badge.svg?branch=main)](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-ci.yml)
[![codecov](https://codecov.io/gh/thc1006/ipas-net-zero-quiz/branch/main/graph/badge.svg)](https://codecov.io/gh/thc1006/ipas-net-zero-quiz)

線上測驗：**<https://thc1006.github.io/ipas-net-zero-quiz/>**

## 題庫

| | 題數 | 說明 |
| --- | ---: | --- |
| **主題庫** | **773 題** | 考科一 431 + 考科二 342。其中 159 題由來源 PDF 分欄重建 |
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

## 這份題庫可不可信

我們把「可不可信」做成**可以自己驗證的東西**，而不是一句宣稱 ——
**包括老實說出哪些地方還做不到：**

- **「有來源」分成三個等級 —— 不要混為一談**

  | 等級 | 意思 | 主題庫 | 練習池 |
  | --- | --- | ---: | ---: |
  | **① 有逐字引文，且經機械驗證** | 我們把來源網頁抓回來，**逐字確認那句話真的在上面** | **470 / 773** | **42 / 154** |
  | ② 有一手來源 URL | 附了法規資料庫／環境部／IPCC／ISO 等的連結（季排程每季檢查是否還通） | 740 / 773 | 149 / 154 |
  | ③ 完全沒有來源 | 來自社群共筆的考古題整理，**無從查證** | 32 / 773 | 0 / 154 |

  ⚠️ **②「有一手來源」不等於「有人看過內容」。** 連結是活的不代表指對地方 ——
  我們抓到過 **19 題引錯法規**（碳費題引到溫管辦法，兩個 URL 都回 200）。

- **「沒有來源」不等於「是錯的」—— 我們去量了** —— 從沒有來源的那批隨機分層抽 **40 題**，
  逐題找一手來源並**用程式把引文抓回原網頁逐字比對**：
  **29 題引文驗證通過，錯誤 0 題**。點估計錯誤率 **0%**，95% 信賴上界約 **10%**（rule of three）。

- **代理的「判定」不算數，只有「證據」算數** —— 三輪共派 50+ 個 AI 代理蒐證，
  契約寫死：**只准交「一手來源 URL + 該頁面上的逐字引文」，找不到就回報找不到，禁止用「我知道」填空**。
  每一筆引文都由 `tools/verify_agent_quotes.py` **抓回原網頁逐字比對**：
  - 第一輪 32 筆引文中，**代理捏造了 1 筆、引了 2 筆非一手來源** —— 全部被擋下，一筆都沒寫進題庫。
  - 第三輪 415 題、377 筆引文通過逐字驗證，同時**抓到 6 筆捏造、4 筆非一手來源**（拿 Google Drive
    當「一手來源」）—— 一筆都沒寫進題庫。
    **捏造率不會因為契約寫得更清楚就歸零。所以擋它的不能是契約，只能是程式。**
  - 找到 **9 題答案是錯的**、**4 題題目本身壞掉**（見下）。
  - ⚠️ **代理也會過度指控 —— 有 3 筆「答案錯了」是它錯了。**
    `gist[484]`／`gist[490]`／`gist[497]` 是計算題，代理主張答案有誤，
    理由是「生質 CO₂ 不該計入排放總量」「綠電係數應為 0」。**那個規則是對的，但結論是錯的** ——
    題目自己給了係數，算術照著給定數據算就是那個答案。
    **缺陷在題幹的前提，不在答案。** 我沒有改答案，而是把正確規則寫進解析，
    並在 `metadata.stem_defect_note` 記下這個判斷。
  - ⚠️ **反過來也有一題是代理對、我錯。** `S_VOCUS_03-q004` 問 ISO 14067 的「數據品質」特性，
    代理說答案「準確度」有問題，我以「公版教材 5.10 就是準確度」駁回了它。
    後來把教材整份抓下來才發現：**5.10 準確度是 §5「原則」，而 §6.3.5「數據品質」
    引的是 CNS 14044 §4.2.3.6.2 的清單 —— 那份清單裡是「精密度」，沒有「準確度」。**
    兩個不同條款，我把它們混為一談。**代理交的是證據，我駁回它靠的是印象。**

- **有 4 題不是答案錯，是「題目本身壞掉」** —— 社群共筆抄題時**保留了官方題幹、卻抄壞了選項**，
  結果是「有兩個以上的正解」。這種題**改答案救不了**：
  - `gist[14]`（治理基礎）：四個選項全被換成「十二項關鍵戰略」，沒有一項是治理基礎
    （治理基礎只有科技研發、氣候法制兩項）—— **四個選項都是正確答案**。
  - `gist[529]`（CCUS）：「捕捉」與「封存／利用」**都是** CCUS 涵蓋的過程 —— 兩個都能選。
  - `gist[532]`（SASB 生態衝擊）：題目問「何者**不正確**」，而原選項 A 與 D **都是不正確的敘述**。
  - 以上三題都依 **iPAS 公版教材的官方選項與答案卡**還原，原選項完整留在
    `metadata.options_replaced`（CI 會擋下沒有一手來源依據、沒有理由的還原）。
  - `gist[61]`（碳中和主體範圍）：公版教材明示「國家」不屬主體範圍，於是「國家」與「個人生活方式」
    **都**不屬於 —— 兩個正解，而**這題沒有官方版本可以還原**。
    **改成任何單一字母都是猜的**，因此改為 `answer: null` 並標記 `ambiguous`，**排除計分**。

- ⚠️ **一道釘住錯誤答案的回歸測試，比沒有測試更難拆。** `gist[304]`（坎昆協議 MRV）被使用者回報過，
  修正後還加了回歸測試釘住答案 C。這次翻出 UNFCCC Decision 1/CP.16 全文才發現：
  回報者指出「ICA 是非附件一國家的機制」**完全正確**，但**排除了錯的選項，不等於找到了對的** ——
  決議全文搜尋 `baseline` / `base year` **各 0 次**，C 根本沒有依據；
  §40(a) 逐字要求的是 "mitigation actions ... and emission reductions achieved"，那是選項 **A**。
  那道測試看起來像是有人驗證過，其實沒有。
- **重建的題目有證據鏈** —— 159 題逐題記錄來自哪一份 PDF（含 sha256）的哪一頁、哪一欄、
  第幾題，以及 PDF 自己印的 answer key。跑 `python tools/restore_from_source_pdf.py --verify`
  可完整重現（實測 **159/159** 相符）
- **改過的答案留得下痕跡** —— 29 題答案曾被更正，每題都保留 `metadata.prior_answer`
  與 `_correction_note`（改了什麼、憑什麼改）。其中 29 題附一手來源 URL，
  另外 0 題的依據是標準條文／公版教材本身 —— 也就是說**每一筆更正都指得出一個可以點開的一手來源**，
  沒有任何一題是靠「我記得」改的。
  推翻來源 PDF 的答案卡需要列明依據，而且 CI 會擋下沒有依據的偏離。
- **引用的法條是逐字的** —— 題庫引用到的 6 部法規（氣候變遷因應法、碳費收費辦法、溫管辦法等）
  逐條原文都釘選在 `law-articles.pinned.json`（含 sha256）。解析裡凡是用「」括起來、
  宣稱是法條原文的句子，CI 會逐字比對 —— 對不上就擋下。
  季排程另會重抓法條比 sha256：**法規一被修訂，CI 就變紅**。
  這是本專案唯一能偵測來源「**內容**變了」（而非只是「連結還通不通」）的機制。
- **AI 產題與人工整理的題目嚴格隔離** —— AI 產題不會混進主題庫，UI 也會標示。
  ⚠️ **但不要相信 `provenance.verify_verdict`。** 它 155/157 都是 `CONFIRMED`，
  而那個判定是「用 AI 驗 AI 產的題」。拿法條原文逐條比對後找到的 **13 個實質缺陷，
  13 個當初全部被判 `CONFIRMED`** —— 包括憑空捏造的法條原文、捏造的法規名稱、
  掛錯的條號。UI 原本據此對使用者說「已通過獨立驗證」，那句話已經移除。
  **一句假的保證比沒有保證更糟。**
- **練習池不會讓你靠猜字母得分** —— 答案分布經 CI 卡方檢定把關（χ² < 7.81），
  沒有任何字母超過 35%。
  ⚠️ 原本**永遠選 B 就能拿 60 分**（來源模擬題本身即 53–73% 集中在 B）；
  已重排選項位置，每題的原字母記在 `provenance.option_order`。
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

題庫中有 **128 題**的答案會隨法規變動（CBAM、碳費、NDC、碳中和標準）。
[`CONTENT-CURRENCY.md`](CONTENT-CURRENCY.md) 記錄已查證到哪一天、**還有什麼沒確定**、
以及下一個到期日（最近的是 **2026-12-15：ISAE 3410 撤回，由 ISSA 5000 取代**）。

⚠️ `meta.content_review.last_review_date` **不代表整份題庫都查證到那一天** ——
本輪只實查 **112 / 773** 題。判斷單一題目請看該題的 `metadata.valid_as_of`。

季排程 `quarterly-time-sensitive-verify` 現在做兩件事，但**能力範圍差很多**：

| | 涵蓋範圍 | 偵測得到「內容變了」嗎 |
| --- | --- | --- |
| 連結健康檢查 | 所有 time_sensitive 題目的來源 URL | ❌ **不行**，只看 HTTP 狀態碼 |
| 法條原文釘選比對 | **只有** `law-articles.pinned.json` 裡那 6 部我國法規 | ✅ 可以，法條一改 sha256 就對不上 |

⚠️ **所以綠燈仍然不等於內容正確。** 釘選只涵蓋 6 部我國法規；
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
