// 解析的衛生規則 —— **主題庫與練習池共用**。
//
// ⚠️ 為什麼抽出來：這條規則原本只寫在 `practice-pool-quality.test.ts` 裡，
// 那個檔案**只 import practice_pool.json** —— 也就是說它**一題主題庫都守不到**。
//
// 這個 repo 的註解已經警告過同一件事至少兩次
// （quality-flags.ts 開頭：「我讀過它，然後又犯了一次」）。**這是第三次。**
// 於是 `gist[304]`（「故 B、D 皆非」）與 `gist[408]`（「A、B、C 都在其中」）
// **從來沒有被任何 gate 檢查過**。

/**
 * 解析裡不可以指涉選項的**字母**。
 *
 * **為什麼**：字母不是內容，它只是位置。而位置**會變**：
 *   - 練習池的選項被重排過（原本永遠選 B 就能拿 60 分 —— 見 provenance.option_order）
 *   - `gist[14]` / `gist[529]` / `gist[532]` 的整組選項被還原成官方版本
 *   - 任何未來的選項調整
 *
 * 一旦位置變了，「答案為 B」「A、D 為 Scope 1」就會**指到別的東西**，
 * 而且**不會有任何測試變紅** —— 解析會安靜地開始說謊。
 *
 * 解析請指涉選項的**內容**（「鍋爐燃料燃燒屬範疇一」），不要指涉它的**字母**。
 */

/** 形式一：關鍵詞 + 字母。「答案為 B」「正解 C」「故選 D」 */
const KEYWORD_THEN_LETTER =
  /(?:選項|答案|正解|正確答案|標準答案|應選|故選|本題答案|此題答案)\s*(?:為|是|應為|即|：|:)?\s*[（(]?\s*[ABCD]\s*[）)]?(?![\w])/u;

/**
 * 形式二：**裸字母清單**。「A、D 為 Scope 1」「A、B、C 都在其中」「B、D 皆非」
 *
 * ⚠️ **這一條才是真正咬人的那個洞。**
 *
 * 舊的規則要求「先有關鍵詞，才接字母」，於是
 * `pool-em-ipas_vocus_mock-036` 的「**A、D 為 Scope 1**」**一路活到第五輪**才被人工稽核抓到 ——
 * 而那句話的實際危害是：它先說 A 屬 Category 1（範疇三），下一句又說 A 是 Scope 1，
 * **自我矛盾，並且在教「採購原物料算範疇一」這個徹底錯誤的觀念**。
 *
 * **一道抓不到 mock-036 的 gate，本來就沒抓到 mock-036。**
 *
 * 實測：在全庫 927 題上，這條規則命中 13 筆，**13 筆全部是真的字母引用，零假陽性**。
 */
const BARE_LETTER_LIST =
  /(?<![A-Za-z0-9])[ABCD]\s*[、,，/／與和及]\s*[ABCD](?:\s*[、,，/／與和及]\s*[ABCD])*(?![A-Za-z0-9])/u;

export interface LetterRef {
  id: string;
  matched: string;
}

/** 找出解析裡所有「指涉選項字母」的寫法。 */
export function findLetterRefs(
  items: ReadonlyArray<{ id: string; explanation?: string | null }>
): LetterRef[] {
  const out: LetterRef[] = [];
  for (const it of items) {
    const ex = it.explanation ?? '';
    if (!ex) continue;
    for (const re of [KEYWORD_THEN_LETTER, BARE_LETTER_LIST]) {
      const m = ex.match(re);
      if (m) out.push({ id: it.id, matched: m[0] });
    }
  }
  return out;
}

/** 給 gate 的自我測試用 —— 確保規則不是空轉。 */
export const LETTER_REF_SAMPLES = {
  shouldMatch: [
    '本題以現行法為準，正解為 C。',
    'A、D 為 Scope 1，C 為 Scope 2。',
    'ICA 屬非附件一國家機制，故 B、D 皆非。',
    '強制揭露內容，A、B、C 都在其中。',
  ],
  shouldNotMatch: [
    '鍋爐燃料燃燒與自家車隊柴油屬範疇一；外購電力屬範疇二。',
    'ISO 14064-1 類別 4 是「來自組織使用的產品」之間接排放。',
    '依碳費收費辦法第 9 條，扣除比率為零點三。',
    'CO2 與 FM200 等氣體滅火器需要盤查。',   // 含 "2"、"200"，不可誤觸
  ],
};
