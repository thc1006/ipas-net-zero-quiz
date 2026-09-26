# schemas/ —— 題庫的機器可讀契約

這個目錄裡的 JSON Schema（draft 2020-12）是**題庫資料格式的權威定義**。
要把這個專案改成另一個考科的考古題平台，你需要的就是讓自己的題庫通過這裡的驗證。

## 為什麼用手寫 JSON Schema，而不是 QTI

調研過三條路：

| 選項 | 結論 |
|---|---|
| **IMS QTI 3.0** | 不採用。QTI 3.0 於 2022 年發布，但**目前沒有任何主流 LMS 的匯入路徑**；Moodle 核心在兩個方向上都不讀 QTI（它走 Aiken／GIFT／Moodle XML）。為一個沒人匯入的標準付出複雜度，換不到互通性 |
| **Moodle GIFT** | 不採用。純文字、好寫，但表達力不足 —— 本專案每一題要掛逐字引文、來源權威分級、條號歸屬、稽核軌跡，GIFT 沒有這些欄位，硬塞會變成註解裡的自由文字，回到「沒人守」的狀態 |
| **自有 JSON + JSON Schema + CI 驗證** | **採用**。這是實務上的通行做法（也是 GETMARKED 等工具把 JSON 轉成 QTI 的前提）。編輯器、CI action、各語言的 validator 都直接支援 |

要匯出成 QTI／GIFT 的話，從這份 JSON 轉出去比反過來容易 —— 但那是需要時才做的事，不是前提。

## 為什麼刪掉了原本的 dataset.schema.json / item.schema.json

這個目錄從 2026-01-22（`c860e25`）就存在，裡面有 `dataset.schema.json` 與 `item.schema.json`，
**八個月沒有人動過，也沒有任何程式碼、工具、CI 或文件引用它們**。

它們描述的是一個**已經不存在的格式**：頂層要求 `meta` / `sources` / `items`，
而現行 `integrated_dataset.json` 是 `meta` / `gist_items` / `our_unique_items`；
`item.schema.json` 要求 `item_id` / `stem` / `credential` / `source` 四個必填，
而主題庫的 gist 題根本沒有 `item_id`（它用 `index`）。用 ajv 實測：

```
現行 integrated_dataset.json 通過那份 schema 嗎？ false
  (root) must have required property 'sources'
  (root) must have required property 'items'
```

一份**描述著不存在格式、又沒有任何東西在驗**的 schema，比沒有 schema 更糟：
它看起來像契約，實際上是誤導。所以刪除，而不是留著並存 ——
否則這個目錄會有四份 schema、其中兩份是假的，正是這個 repo 反覆在修的「多份會漂」。

## 檔案

| 檔案 | 驗證對象 |
|---|---|
| `main-bank.schema.json` | `quiz-app/src/data/integrated_dataset.json` |
| `practice-pool.schema.json` | `quiz-app/src/data/practice_pool.json` |

## 換題庫時要改的地方

schema 刻意把「領域專有的詞彙」集中在 `$defs` 裡的幾個位置，而不是散落各處：

- `main-bank.schema.json#/$defs/examSubject` —— 考科代碼（現為 `考科1`／`考科2`）
- `practice-pool.schema.json#/$defs/qualityFlag` —— 品質旗標詞彙
- `practice-pool.schema.json#/$defs/sourceType` —— 題目來源類型
- `practice-pool.schema.json#/$defs/difficulty` —— 難度等級

改這幾處，其餘結構（選項、答案、引文、稽核欄位）都是與考科無關的。

## 這份 schema 不會跟程式碼漂掉

`quiz-app/src/data/schema-contract.test.ts` 釘住三件事：

1. 現行兩個題庫都必須通過 schema 驗證；
2. schema 的列舉值必須與 TypeScript 那份常數**完全相同**（不是「看起來一樣」）；
3. 同一批刻意做壞的資料，schema 與手寫 validator 必須**都**拒收 ——
   兩者只要有一邊放行，就是契約出現裂縫。

第 3 點是關鍵：這個 repo 已經被「同一條規則寫兩份、其中一份較寬」咬過四次
（字母引用規則、法規別名表各一次，詳見那兩支檔案的註解）。
schema 是第三份對「什麼叫合法題目」的描述，所以一開始就把它和既有 validator 綁在一起。

## 換題庫的完整步驟

1. 讓你的資料通過這裡的兩份 schema；
2. 改 [`../platform.config.json`](../platform.config.json)（名稱、網址、SEO 文案）；
3. 改本目錄 `main-bank.schema.json` 的 `$defs/examSubject`，並同步
   `src/utils/main-bank-schema.ts` 的 `EXAM_SUBJECTS`、`src/types/quiz.ts` 的 `ExamSubject`；
4. `pnpm test:run -u` 重新產生語料輪廓 snapshot；
5. 依 `src/data/content-profile.test.ts` 列出的清單，重設那幾個棘輪／反空轉門檻。

## 已知不足（誠實列出）

- **schema 與手寫 validator 是兩份**。目前靠 `schema-contract.test.ts` 釘住兩者一致
  （包含 13 種刻意做壞的資料必須被雙方拒收）。但那是用測試警察一個設計缺陷 ——
  正規做法是**只留一份來源**：TypeBox 的 schema 本身就是 JSON Schema（型別由它靜態推導），
  或 Zod v4 原生輸出 JSON Schema（`zod-to-json-schema` 已於 2025-11 停止維護）。
  改過去會**刪掉** `practice-pool-schema.ts` 與 `main-bank-schema.ts` 共約 400 行，
  而不是再多一個測試。這是下一步該做的事。
- **沒有提供匯出**。最接近的前例 `rosstimo/quizbank` 是「一份 JSON bank → 產出 PDF／Markdown／
  Canvas QTI」。本專案目前只有自己的格式；要與 LMS 互通，缺的是一支匯出器
  （從這份 JSON 轉出去比反過來容易），而不是改用別人的格式當主格式。
- **`ExamSubject` 仍寫在型別層**（`'考科1' | '考科2'`），牽動 11 個非測試引擎檔。
  改成資料驅動是比較大的重構，尚未進行。
