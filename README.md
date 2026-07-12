# 淨零碳規劃管理師備考神器 | iPAS 淨零碳規劃管理師考古題

[![Deploy Quiz App to GitHub Pages](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-deploy.yml/badge.svg)](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-deploy.yml)
[![Quiz App CI](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-ci.yml/badge.svg?branch=main)](https://github.com/thc1006/ipas-net-zero-quiz/actions/workflows/quiz-app-ci.yml)
[![codecov](https://codecov.io/gh/thc1006/ipas-net-zero-quiz/branch/main/graph/badge.svg)](https://codecov.io/gh/thc1006/ipas-net-zero-quiz)

線上測驗：**https://thc1006.github.io/ipas-net-zero-quiz/**

## 功能特色

- **780 題主題庫**：涵蓋考科一（淨零碳規劃管理基礎）與考科二（碳盤查規範與程序）
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

### 考科二：淨零碳盤查規範與程序概要
- ISO 14064-1:2018 六分類（Cat 1–6）盤查範疇
- 組織碳盤查邊界（營運／財務／股權控制法）
- 排放係數與計算方法、AR5 GWP（環境部 113/2/5 公告）
- 碳盤查報告與查證、CFP-PCR、產品碳足跡

> **考科歸屬的依據是官方評鑑內容，不是坊間整理的考古題文件。**
>
> 依「115 年度 iPAS 淨零碳規劃管理師能力鑑定簡章」§2.5：
>
> | 科目 | 評鑑內容 |
> |---|---|
> | 科目一 `L11` | …`L11202` 國際碳稅關貿政策（如 **CBAM** 等）、`L11205` **ISO 14068-1** 碳中和標準… |
> | 科目二 `L12` | `L121` **ISO 14064-1:2018** 組織型盤查、`L122` **ISO 14067:2018** 產品碳足跡 |
>
> 也就是說 **科目二只涵蓋 ISO 14064-1 與 ISO 14067**，不含任何政策／貿易／碳中和標準 ——
> CBAM、ISO 14068-1、PAS 2060 都屬**科目一**。
>
> 本專案曾一度依「原始考古題 .md 把 CBAM 放在考科二段落」而把它們歸為考科二，**那是錯的**：
> 那份是社群整理的文件，同一段落裡還混著 ISO 14068-1（官方 L11205，科目一）的題目。
> 現已依官方評鑑內容更正，並由 `dataset-integrity.test.ts` 釘住 —— 考科2 不得再出現
> CBAM / ISO 14068-1 / PAS 2060 的題目。

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

題庫中有 112 題的答案會隨法規變動（CBAM、碳費、NDC、碳中和標準）。
[`CONTENT-CURRENCY.md`](CONTENT-CURRENCY.md) 記錄已查證到哪一天、**還有什麼沒確定**、以及下一個到期日
（最近的是 **2026-12-15：ISAE 3410 撤回，由 ISSA 5000 取代**）。

⚠️ `meta.content_review.last_review_date` **不代表整份題庫都查證到那一天** —— 本輪只實查 100/780 題。
判斷單一題目請看該題的 `metadata.valid_as_of`。

⚠️ `quarterly-time-sensitive-verify` workflow **只驗連結還通不通，驗不出內容變了** —— 綠燈不等於內容正確。
（CBAM 憑證繳交期限 5/31 → 9/30、臺灣 2030 NDC 24%±1% → 28%±2%，網址全程都是活的。）

### 連結健康檢查怎麼判定「失效」

只有這兩類會開 issue，其餘一律只警告：

| 分類 | 條件 | 開 issue？ |
|---|---|---|
| `DEAD` | HTTP **404 / 410** | ✅ |
| `DEAD_DNS` | curl exit 6，**且** 1.1.1.1 與 8.8.8.8 **兩個獨立 resolver 都回 NXDOMAIN** | ✅ |
| `UNREACHABLE_DNS` | curl exit 6，但未經兩個 resolver 確認（可能只是 resolver 抖動） | ❌ |
| `BLOCKED` | 401 / 403 / 405 / 429 / 451（WAF 擋 runner，站台活著） | ❌ |
| `RETRYABLE` | 408 / 425 / 5xx（伺服器暫時性問題） | ❌ |
| `UNREACHABLE_*` | curl exit ≠ 0（7=connect、28=timeout、35/60=TLS） | ❌ |
| `OTHER` | 其餘 HTTP 碼 —— **明示列出，絕不靜默歸成 DEAD** | ❌ |

`curl exit 6` 只代表「無法解析主機」，**不等於網域已停用**——暫時性 resolver 故障、SERVFAIL、
runner 自己的 DNS 問題都長成同一個 exit code。**寧可漏報，不要誤報**：拿不到 `dig` 就一律降級。

分類器、`check_url` glue、聚合三層都抽成腳本並有**離線測試**（`.github/scripts/*.test.sh`，
用 PATH 注入的假 curl／假 dig，不碰網路），每個 PR 都跑：

```bash
bash .github/scripts/url-status.test.sh          # 分類矩陣
bash .github/scripts/check-url.test.sh           # curl -> DNS 二次確認 -> 分類 的 glue
bash .github/scripts/aggregate-results.test.sh   # 計數與 $GITHUB_OUTPUT
bash .github/scripts/check-description.test.sh   # GitHub About 的題數
```

> 為什麼連 glue 都要測：這幾支測試寫出來的第一次執行，就抓到「兩個 resolver 都要同意」那道把關
> 其實是**假的**——`resolve_dns_status` 最後一行 `else echo "$r1"` 會把「只有一個 resolver 說
> NXDOMAIN」也放行。**一個永遠不會擋下任何東西的把關，等於沒有把關。**

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

實測 **159/159** 相符（頁碼／欄位／題號／answer key／raw & canonical 文字 hash／repo 文字 hash）。

#### 三個 hash，各自回答一個不同的問題

| 欄位 | 它證明什麼 |
|---|---|
| `raw_pdf_text_sha256` | PDF 原文長什麼樣（分欄擷取後，**一個字都沒動**） |
| `canonical_source_text_sha256` | 套用 `transformations` 所列的修正**之後**長什麼樣 |
| `dataset_text_sha256` | repo 裡「現在」長什麼樣 |
| `transformations[]` | 這一題**動了什麼、憑什麼動**。空陣列＝原文照抄 |

不變式（`--emit` 與 CI 各擋一次）：**`raw ≠ canonical` ⟺ `transformations` 非空**。
有差異卻沒列明＝藏起來的手腳；列明了卻沒差異＝記錄與事實不符。兩種都會失敗。

> 為什麼要分這麼細：先前只存一個 `pdf_text_sha256`，名字宣稱是「PDF 裡的文字」，實際存的卻是
> **套用修正後**的文字（S_CHU_06 第 37 題的選項標號在 PDF 原文是 `(A)(B)(B)(C)`，被改成 `(A)(B)(C)(D)`）。
> 結果任何人拿原始 PDF 重算都會對不上，而且看不出為什麼。
> **一條只有作者本人重跑同一支腳本才對得上的證據鏈，不是證據鏈。**

#### 來源的每一題都要有交代

manifest 不只記「我還原了什麼」，也記「我**沒有**還原什麼、為什麼」——
來源 PDF 全部 **170** 題逐題都有 disposition：

| disposition | 數量 | 憑據 |
|---|---:|---|
| `restored` | 159 | 已還原進題庫 |
| `duplicate_within_source` | 8 | PDF 自己重印了同一題（normalized hash 完全相同，並指出重複於第幾題） |
| `duplicate_in_dataset` | 3 | 主庫已有內容幾乎相同的題目（附相似度與比對對象） |
| `UNACCOUNTED` | **0** | 只要有一題落到這裡，`--emit` 直接失敗 |

> 先前的程式是 `if item_id not in by_item: continue  # 一定是重複題`——那行註解是**斷言**，不是驗證。
> 真的在還原過程中掉了一題，它也會安靜地說成「重複」。
> **一份只講「我留下了什麼」而不講「我丟掉了什麼、為什麼」的憑證，證明不了「沒有東西被弄丟」。**
>
> 這個稽核當場抓到一個**教錯的答案**：一題被當成「重複」丟掉的來源題，它自己印的 answer key
> 與主庫教的答案互相矛盾（ISO 14064-1:2018 強制揭露項目，主庫答 C、來源答 D——**D 才是對的**）。
> 靜默去重把來源題丟掉的同時，也丟掉了那張本來可以當場戳破錯誤的答案卡。

## 問題回報

如有任何問題或建議，請至 [Discussions #1](https://github.com/thc1006/ipas-net-zero-quiz/discussions/1) 回報。
