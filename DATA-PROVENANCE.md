# 資料從哪來、憑什麼相信

這份文件回答一件事：**這個題庫宣稱的東西，別人要怎麼自己驗證？**

一句「我們有查證」是沒有意義的。所以每一個宣稱，下面都對應一個**任何人都能自己跑一遍**的檢查。

- 題庫規模、時效性數字 → [`CONTENT-CURRENCY.md`](CONTENT-CURRENCY.md)
- 開發／測試指令 → [`README.md`](README.md#開發)

---

## 考科歸屬：依官方評鑑內容，不是坊間的考古題整理

依「iPAS 淨零碳規劃管理師能力鑑定簡章」§2.5 評鑑主題與評鑑內容：

| 科目 | 評鑑內容 |
|---|---|
| **科目一** `L11` 淨零碳規劃管理基礎概論 | …`L11202` 國際碳稅關貿政策（如 **CBAM** 等）、`L11205` **ISO 14068-1 碳中和標準**… |
| **科目二** `L12` 淨零碳盤查規範與程序概要 | `L121` **ISO 14064-1:2018** 組織型盤查、`L122` **ISO 14067:2018** 產品碳足跡 |

也就是說**科目二只涵蓋 ISO 14064-1 與 ISO 14067**，不含任何政策／貿易／碳中和標準。
**CBAM、ISO 14068-1、PAS 2060 都屬科目一。**

> 本專案曾一度把 CBAM 題歸為考科二，理由是「原始考古題 .md 把它們放在考科二段落底下」。
> **那是錯的** —— 那份 .md 是社群整理的文件，同一段落裡還混著 ISO 14068-1（官方 L11205，
> 科目一）與巴黎協定的題目，是貼錯位置的產物。社群文件的段落不能拿來當考科歸屬的依據。
>
> 已由 `dataset-integrity.test.ts` 釘住：考科2 不得再出現 CBAM / ISO 14068-1 / PAS 2060 的題目。

---

## 159 題是從來源 PDF 重建的

2026-01-23 的一次清理，面對來源 PDF「雙欄排版轉純文字時左右欄交錯」而壞掉的題目，
是**直接刪掉**而非修復。而且錯置把成對的題目黏在一起，170 題被壓成 77 個壞掉的 item。

現已改由來源 PDF（本身內嵌答案 key）以**分欄擷取**重建。
[`restoration-manifest.json`](quiz-app/src/data/restoration-manifest.json) 逐題記錄：
來自哪一份 PDF（含 **sha256**）的**哪一頁、哪一欄、第幾題**，以及 PDF 自己印的 **answer key**。

```bash
# CI 不下載 PDF：只驗 manifest ↔ 題庫一致（防竄改），離線、秒級
pnpm vitest run src/data/restoration-manifest.test.ts

# 完整重現（人工）：重新下載 PDF、比對 sha256、重跑分欄擷取、逐題核對
pip install pdfplumber
python tools/restore_from_source_pdf.py --verify
```

實測 **159/159** 相符。

### 三個 hash，各自回答一個不同的問題

| 欄位 | 它證明什麼 |
|---|---|
| `raw_pdf_text_sha256` | PDF 原文長什麼樣（分欄擷取後，**一個字都沒動**） |
| `canonical_source_text_sha256` | 套用 `transformations` 所列的修正**之後**長什麼樣 |
| `dataset_text_sha256` | repo 裡**現在**長什麼樣 |
| `transformations[]` | 這一題**動了什麼、憑什麼動**。空陣列＝原文照抄 |

不變式（`--emit` 與 CI 各擋一次）：**`raw ≠ canonical` ⟺ `transformations` 非空**
—— 有差異卻沒列明＝藏起來的手腳；列明了卻沒差異＝記錄與事實不符。兩種都失敗。

> **為什麼要分這麼細**：先前只存一個 `pdf_text_sha256`，名字宣稱是「PDF 裡的文字」，
> 實際存的卻是**套用修正後**的文字（某題選項標號在 PDF 原文是 `(A)(B)(B)(C)`，被改成 `(A)(B)(C)(D)`）。
> 結果任何人拿原始 PDF 重算都會對不上，而且看不出為什麼。
> **一條只有作者本人重跑同一支腳本才對得上的證據鏈，不是證據鏈。**

### 來源的每一題都要有交代

manifest 不只記「我還原了什麼」，也記「我**沒有**還原什麼、為什麼」。
來源 PDF 全部 **170 題**逐題都有 disposition：

| disposition | 數量 | 憑據 |
|---|---:|---|
| `restored` | 159 | 已還原進題庫 |
| `duplicate_within_source` | 8 | PDF 自己重印了同一題（正規化 hash 完全相同，並指出重複於第幾題） |
| `duplicate_in_dataset` | 3 | 題庫已有內容幾乎相同的題目（附相似度與比對對象） |
| `UNACCOUNTED` | **0** | 只要有一題落到這裡，`--emit` 直接失敗 |

> 先前的程式是 `if item_id not in by_item: continue  # 一定是重複題` ——
> 那行註解是**斷言**，不是驗證。真的在還原過程中掉了一題，它也會安靜地說成「重複」。
> **一份只講「我留下了什麼」而不講「我丟掉了什麼、為什麼」的憑證，證明不了「沒有東西被弄丟」。**
>
> 這個稽核當場抓到一個**教錯的答案**：一題被當成「重複」丟掉的來源題，它自己印的 answer key
> 與題庫教的答案互相矛盾（ISO 14064-1:2018 強制揭露項目，題庫答 C、來源答 D —— **D 才是對的**，
> 依 §9.3.1(g) 與規範性附錄 E）。**靜默去重把來源題丟掉的同時，也丟掉了那張本來可以當場戳破錯誤的答案卡。**

---

## 連結健康檢查：什麼才算「失效」

季排程（`quarterly-time-sensitive-verify`）會 curl 每一條 `time_sensitive` 題目的來源 URL。
**只有這兩類會開 issue，其餘一律只警告：**

| 分類 | 條件 | 開 issue？ |
|---|---|:---:|
| `DEAD` | HTTP **404 / 410** | ✅ |
| `DEAD_DNS` | curl exit 6，**且** 1.1.1.1 與 8.8.8.8 **兩個獨立 resolver 都回 NXDOMAIN** | ✅ |
| `UNREACHABLE_DNS` | curl exit 6，但未經兩個 resolver 確認（可能只是 resolver 抖動） | ❌ |
| `BLOCKED` | 401 / 403 / 405 / 429 / 451（WAF 擋 runner，站台活著） | ❌ |
| `RETRYABLE` | 408 / 425 / 5xx（伺服器暫時性問題） | ❌ |
| `UNREACHABLE_*` | curl exit ≠ 0（7=connect、28=timeout、35/60=TLS） | ❌ |
| `OTHER` | 其餘 HTTP 碼 —— **明示列出，絕不靜默歸成 DEAD** | ❌ |

`curl exit 6` 只代表「無法解析主機」，**不等於網域已停用** —— 暫時性 resolver 故障、SERVFAIL、
runner 自己的 DNS 問題都長成同一個 exit code。**寧可漏報，不要誤報**：拿不到 `dig` 就一律降級，
並在報表上明講「這次沒有 dig，`DEAD_DNS = 0` 不代表沒有網域死掉」。

> ⚠️ 這個檢查**只驗網址還通不通，驗不出內容變了**。CBAM 憑證繳交期限從 5/31 改成 9/30、
> 臺灣 2030 NDC 從 24%±1% 上調到 28%±2% —— 網址全程都是活的。**綠燈不等於內容正確。**

---

## 測試策略：一個抓不到錯的把關，等於沒有把關

分類器、`check_url` glue、聚合三層都抽成腳本，並有**離線測試**（不碰網路，用 PATH 注入的
假 curl／假 dig），每個 PR 都跑：

```bash
bash .github/scripts/url-status.test.sh          # 分類矩陣
bash .github/scripts/check-url.test.sh           # curl -> DNS 二次確認 -> 分類 的 glue
bash .github/scripts/aggregate-results.test.sh   # 計數與 $GITHUB_OUTPUT
bash .github/scripts/check-description.test.sh   # GitHub About 的題數
```

所有 gate 都以**變異測試**驗證過鑑別力 —— 把它要守的東西改壞，它就必須變紅。
這個習慣抓到過三個**假把關**：

- **「兩個 resolver 都要同意」其實是假的**：`resolve_dns_status` 最後一行 `else echo "$r1"`
  會把「只有一個 resolver 說 NXDOMAIN」也放行。一個被劫持的 resolver 就足以誤報網域死亡。
- **`is_failure()` 是死程式碼**：它有 10 項單元測試、註解宣稱自己是「什麼算失效」的單一事實來源，
  但生產路徑上**沒有任何地方呼叫它** —— 真正做決定的是別處手抄的清單。那 10 項測試給的是假的信心。
- **守著「唯一真正抓到的錯」的那條測試，自己抓不到錯**：它的鑑別力全押在一個**選填**欄位上，
  欄位一消失或型別一跑掉，就靜默變綠。

**文件也不能對資料說謊**：README、網站文案（`index.html`）、給 AI 爬蟲的 `llms.txt`、
甚至 **GitHub 的 About**，上面每一個題數都由 CI 對著資料實算比對，對不上就擋下 merge。
（About 不在 git 裡，得用 `gh api` 讀 —— 這正是它曾經錯了很久沒人發現的原因。）
