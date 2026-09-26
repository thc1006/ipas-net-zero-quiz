# AGENTS.md

給在這個 repo 工作的 AI 代理。人類貢獻者看 [`README.md`](README.md) 就好。

這份檔案的重點**不是**專案介紹，而是**這個 repo 真的咬過人的陷阱**。
下面每一條都對應一次實際發生過的錯誤 —— 包含代理自己犯的。

---

## 1. 這個專案在做什麼

iPAS 淨零碳規劃管理師的考古題練習站。與一般題庫站的差別是：
**每一題都要留下「憑什麼這樣答」的痕跡，並且留下做不到的地方。**

- 引擎：`quiz-app/`（React 18 + TS strict + Vite 6 + Vitest + Playwright）
- 題庫：`quiz-app/src/data/integrated_dataset.json`（主題庫）、`practice_pool.json`（加強練習池）
- 資料契約：`schemas/`（JSON Schema draft 2020-12）
- 維運工具：`tools/*.py`
- 證據與時效文件：`DATA-PROVENANCE.md`、`CONTENT-CURRENCY.md`、`VERIFICATION-GAPS.md`

## 2. 指令

```bash
corepack enable && pnpm install        # 在 quiz-app/ 下
pnpm test:run                          # 單元測試（改任何東西都要跑）
pnpm test:run -u                       # 重新產生語料輪廓 snapshot（換題庫時）
pnpm build                             # tsc + vite build（tsc 會檢查測試檔）
pnpm lint && pnpm type-check
python tools/sync_derived_counts.py    # 改動資料後必跑：同步文件裡的數字
python tools/build_evidence_manifest.py
python tools/gen_gap_reports.py        # 產生 VERIFICATION-GAPS.md（不要手改那個檔）
```

改完資料的標準收尾是這三步：`build_evidence_manifest` → `sync_derived_counts` → `pnpm test:run`。

## 3. 絕對規則

- **未經專案所有者明確同意，不得合併 PR。** 合併會自動部署到 GitHub Pages。
- **commit 訊息不得有 AI 署名**（無 Co-Authored-By AI、無「Generated with」、無機器人圖示）。
- **全 repo 不使用 emoji**，包含文件、註解、資料。
- **不要主動在 GitHub 上留言**。被要求「處理 PR 上的問題」是指修掉問題，不是去回覆。
- **回報宣稱前先自己驗證**。外部複審常常針對舊的 commit；量化的宣稱要自己重算一次。

## 4. 這個 repo 咬過人的陷阱

### 4.1 引文存在兩個不同位置

主題庫在 `metadata.evidence`，練習池在 `provenance.evidence`。
**這個不對稱已經讓兩道 gate 只守了一半**（`clause-citation` 與 `evidence-display` 都曾經
只讀 `metadata.evidence`，於是對整個練習池永遠通過）。
寫任何掃描引文的程式，一定要同時讀兩處。

### 4.2 檢查回傳 0 的時候，先懷疑檢查本身

實際發生過三次：
- 對空文件 grep，得到「0 次」，於是宣稱某個字串不存在；
- 找 `_law_anchor` 只看 `provenance` 底下，而它在 item 頂層 —— 回報「0 筆」，實際有 6 筆；
- 在某個分支上查，卻把結論當成全 repo 的事實。

**先用一個「應該要命中」的樣本確認檢查有效，再相信它回傳的 0。**

### 4.3 在一個目錄裡新增檔案之前，先 `ls` 它

`schemas/` 從 2026-01 就存在兩份 schema，八個月沒人動、也沒人引用。
代理沒有 `ls` 就在同一個目錄新增檔案，還宣稱「這個 repo 沒有 schema」——
一度讓那個目錄有四份 schema、其中兩份描述著不存在的格式。

### 4.4 不要用「把問題搬走」讓 gate 轉綠

`clause-citation` 只檢查題幹的條號。代理為了讓它轉綠，把條號從題幹搬到解析 ——
**可驗證性一點沒變，只是 gate 看不到了。**
同類：不要為了讓 gate 綠而放寬判準、加例外、或把斷言改成永遠成立。
gate 紅的時候，先問「它抓到的是真的嗎」。

### 4.5 每一道 gate 都要 mutation 驗證

代理寫過一條「先用 `isQuestionScorable` 過濾、再檢查有沒有阻斷旗標」的 gate ——
被過濾掉的題目永遠不會進入檢查，`bad` 永遠是空陣列。**那條 gate 從來沒有在守任何東西。**
判準：故意把資料或程式改壞，那道 gate 必須轉紅。做不到就是空轉。

反空轉斷言（`expect(x.length).toBeGreaterThan(N)`）也要有 —— 但它們會把語料規模寫死，
見第 6 節。

### 4.6 文件裡的數字：gate 守幾個，工具就要同步幾個

`docs-counts.test.ts` 釘住 README / `index.html` / `llms.txt` / `DATA-PROVENANCE.md` 裡的數字，
`tools/sync_derived_counts.py` 負責把它們寫對。**兩邊的涵蓋範圍必須一致。**

實測過：在主題庫加一題 → 同步工具 exit 0 印出「所有衍生數字都已一致」，而 CI 紅了五條。
另外那支工具的規則預設只改**第一個** match，而題數在 `index.html` 出現 4 次 ——
需要全部取代時要用 `'all'` 模式。

新增任何「文件裡的數字」時：**同時加 gate 與同步規則，否則下一個人加題就會撞紅燈。**

### 4.7 部署網址與平台名稱只有一份來源

`platform.config.json`。`index.html` 與 `public/{llms.txt,robots.txt,sitemap.xml}`
只寫 `%PLATFORM_*%` 佔位符，build 時由 vite 插件注入。
有 gate 同時要求「不得含 siteUrl 字面值」與「必須含佔位符」—— 只有前者會空轉。

### 4.8 逐字引文不可以是意譯

解析裡用「」括起來又提到法規的句子，`law-quote-integrity` 會拿去和
`law-articles.pinned.json` 的條文原文逐字比對（sha256 監控）。
是意譯、是條文標題、是法規名稱 → **不要加引號**。

`evidence[].clause` 是**人工宣告的溯源資訊，不是證明**：
`clause-citation` 刻意不把它當成綁定條件（自我宣告不能當成它自己的證據）。

### 4.9 由來源 PDF 還原的題目必須逐字忠於來源

`our_unique_items` 裡有 159 題由 PDF 分欄重建，`restoration-manifest.json` 以 sha256 釘死。
就地改題幹會破壞保真契約（測試會擋）。要修術語問題，用 `source_terminology_note` 記錄，
不要改字。

### 4.10 工具與語言層面的地雷

- Python heredoc 裡的 `\n`、`\s`、`\*` 會被吃掉或變成真的控制字元。
  寫入 TS 檔的 regex 一律用 **`String.raw`**；JS 的模板字串與普通字串都會把 `\s`
  當 identity escape 變成字面 `s`，整條規則會**安靜失效**（踩過兩次）。
- Python 讀不到 Git Bash 的 `/tmp`。臨時檔用 scratchpad 目錄。
- 一律 `export PYTHONIOENCODING=utf-8`。
- `pnpm build` 會跑 `tsc`，**測試檔的型別錯誤會讓 build 失敗**；只跑 vitest 看不出來
  （vitest 只轉譯、不檢查型別）。

## 5. 改一題的流程

1. 先確認問題真的存在（讀資料，不要相信描述）。
2. 改資料；解析裡每個條號／標準編號／百分比／年份／數量，都必須能在
   題幹、選項或引文裡找到 —— `tools/explanation_guard.py` 的 `check()` 會驗。
3. 引文放對位置（見 4.1），並帶 `supports_option`（必須等於該題 `answer`，否則 UI 不顯示）。
4. `build_evidence_manifest` → `sync_derived_counts` → `pnpm test:run`。
5. 把「為什麼這樣改」寫進該題的 `provenance`／`metadata`，不是只寫在 commit 訊息裡。
   下一輪複核的人只看得到資料。

## 6. 換成別的考科題庫

`schemas/README.md` 有完整步驟。要注意的是：

- 有一批 CI 斷言把**本題庫的語料規模**寫死（反空轉用），換題庫時會全部紅。
  清單在 `quiz-app/src/data/content-profile.test.ts`，語料輪廓本身是 snapshot，
  跑 `pnpm test:run -u` 重新產生。
- **棘輪刻意不是 snapshot**（例如「無腦選最長」的得分率上限）：snapshot 的語意是
  「變了就更新」，會讓退步被一句 `-u` 抹掉。棘輪要人工重設。
- `ExamSubject` 目前寫在型別層（`'考科1' | '考科2'`），牽動 11 個非測試檔 —— 尚未資料驅動。

## 7. 這份檔案的維護方式

**每次踩到新坑就加一條，並寫下它實際造成了什麼後果。**
不要寫成通則式的最佳實踐清單 —— 那種內容代理本來就會，寫了也不會改變行為。
有價值的是「在這個 repo，這樣做過，結果是這樣」。
