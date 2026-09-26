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
