# AGENTS.md

給在這個 repo 工作的 AI 代理。人類貢獻者請看 [`README.md`](README.md)。

## 完成的定義

所有工作在下列命令回傳 0 之前，都**不算完成**：

```bash
cd quiz-app && pnpm preflight
```

它依序執行：同步衍生資料 → lint → 單元測試 → `tsc` + build。
**不要只跑 `pnpm test:run`** —— vitest 只轉譯不檢查型別，測試檔的型別錯誤只有 build 抓得到。

改到 `tools/` 或 `quiz-app/src/data/__fixtures__/normalized_text_sha256_vectors.json`（Python 端也讀這份向量）
的工作，另外要在 repo 根目錄跑這一條並回傳 0（preflight 不含它）：

```bash
uv run --locked --directory tools pytest
```

## 命令

```bash
cd quiz-app
corepack enable && pnpm install
pnpm preflight        # 收尾必跑（見上）
pnpm test:run         # 只跑單元測試
pnpm test:run -u      # 重新產生語料輪廓 snapshot（換題庫時）
pnpm test:e2e         # Playwright
pnpm dev              # 開發（含 schema fail-fast）

cd .. && python tools/gen_gap_reports.py    # 產生 docs/VERIFICATION-GAPS.md
```

`tools/*.py` **必須從 repo 根目錄執行**（它們用根目錄相對路徑）。
一律先 `export PYTHONIOENCODING=utf-8`。

## 絕不可以

- **絕不** `git push` 到 `main`，**絕不**合併 PR —— 未經專案所有者明確同意。合併會自動部署。
- **絕不**在 commit 訊息放 AI 署名（Co-Authored-By AI、「Generated with」、機器人圖示）。
- **絕不**在任何檔案使用 emoji，包含文件、註解、資料。
- **絕不**主動在 GitHub 留言。「處理 PR 上的問題」是指修掉問題，不是去回覆。
- **絕不**為了讓 gate 轉綠而放寬判準、加例外、或把問題搬到 gate 看不到的地方。
- **絕不**修改 `our_unique_items` 裡由 PDF 還原的題幹（`restoration-manifest.json` 以 sha256 釘死）。
  要記錄術語問題用 `source_terminology_note`。
- **絕不**手改 `docs/VERIFICATION-GAPS.md`、`docs/NEEDS-SOURCING.md`、`docs/evidence-manifest.json`
  （都是生成物）。

## 升級規則

- 同一道 gate 修三次還是紅 → **停下來報告**，不要改判準。
- 要動 `restoration-manifest.json` 或 `law-articles.pinned.json` → **先問**。
- 資料與文件的數字對不上 → 跑 `pnpm preflight`，不要手改數字。

## 改資料時

1. 先讀資料確認問題真的存在，不要相信描述（外部複審常針對舊 commit）。
2. 引文放對位置：**主題庫在 `metadata.evidence`，練習池在 `provenance.evidence`。**
   寫任何掃描引文的程式都要同時讀兩處 —— 這個不對稱已讓兩道 gate 只守了一半。
3. 引文要帶 `supports_option`，且必須等於該題 `answer`，否則 UI 不顯示（fail-closed）。
4. 解析裡每個條號／標準編號／百分比／年份／數量，都必須能在題幹、選項或引文裡找到。
   驗法：`python -c "import sys;sys.path.insert(0,'tools');from explanation_guard import check;..."`
5. 解析裡用「」括起來又提到法規的句子會被逐字比對釘選條文。是意譯就**不要加引號**。
6. 把「為什麼這樣改」寫進該題的 `provenance`／`metadata`，不是只寫在 commit 訊息裡。
7. `pnpm preflight`。

## 寫 gate 時

- **每一道 gate 都要 mutation 驗證**：故意把資料或程式改壞，它必須轉紅。做不到就是空轉。
  本 repo 出過一條「先過濾再檢查」的 gate，`bad` 永遠是空陣列，從未守住任何東西。
- 反空轉斷言（`toBeGreaterThan(N)`）必須有，但它會把語料規模寫死 ——
  新增時同步登記到 `quiz-app/src/data/content-profile.test.ts` 的清單。
- **regex 一律用 `String.raw`**。普通字串與模板字串都會把 `\s` 當 identity escape 變成字面 `s`，
  規則會安靜失效（踩過兩次）。
- 新增「文件裡的數字」時，**同時**加 gate 與 `tools/sync_derived_counts.py` 的同步規則。
  只有 gate 沒有規則 → 下一個人加題就撞紅燈，而工具會說沒事（實測過）。
  數字在同一個檔出現多次時，規則要用 `'all'` 模式（預設只改第一個 match）。

## 查證時

- **檢查回傳 0 的時候，先懷疑檢查本身。** 用一個「應該要命中」的樣本確認它有效，再相信 0。
  踩過三次：對空文件 grep、找錯巢狀層級（`_law_anchor` 實際有 6 筆卻回報 0）、在錯的分支查。
- **在一個目錄新增檔案前先 `ls` 它。** `schemas/` 有兩份八個月沒人碰的死 schema，
  代理沒看就在同目錄新增，一度讓那裡有四份 schema、兩份描述不存在的格式。
- 網頁抓不到時（403／需登入）不要放棄就宣稱「查不到」。已知可用的替代：
  ISO 目次用官方 FDIS 預覽本、IFRS 中文全文用會計研究發展基金會（`ardf.org.tw`）。

## 平台識別

`platform.config.json` 是唯一來源。`index.html` 與 `public/{llms.txt,robots.txt,sitemap.xml}`
只寫 `%PLATFORM_*%` 佔位符，build 時注入。**絕不**硬編部署網址。

## 檔案在哪

| 路徑 | 內容 |
| --- | --- |
| `quiz-app/src/data/*.json` | 題庫（主題庫、練習池、釘選法條） |
| `schemas/` | 題庫的 JSON Schema（權威契約） |
| `docs/` | 證據鏈、時效、缺口報告 |
| `tools/` | 維運工具（Python） |
| `quiz-app/src/data/*.test.ts` | 資料層 gate（改資料最常撞這裡） |

## 維護這份檔案

每次踩到新坑就加一條，**寫成命令或禁止事項，不要寫成敘述**。
研究結論很明確：敘述式段落代理讀了不會執行；可驗證的命令與明確的禁止才會改變行為。
