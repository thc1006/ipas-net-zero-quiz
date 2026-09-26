// 解析的衛生規則 —— **主題庫與練習池共用**。
//
// 為什麼抽出來：這條規則原本只寫在 `practice-pool-quality.test.ts` 裡，
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
  /(?:選項|答案|正解|正確答案|標準答案|應選|故選|本題答案|此題答案)\s*(?:為|是|應為|即|：|:)?\s*[（(]?\s*([ABCD])\s*[）)]?(?![\w])/u;

/**
 * 形式二：**裸字母清單**。「A、D 為 Scope 1」「A、B、C 都在其中」「B、D 皆非」
 *
 * **這一條才是真正咬人的那個洞。**
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

/**
 * 形式三：**單一字母被當成選項在用**。「說 A 屬 Category 1」「故 A 為不正確之敘述」「以 D 為最佳解」
 *
 * 形式二只抓「兩個以上」的字母清單，所以這種**單字母**的指稱一開始整個漏掉 ——
 * 包括 `mock-036` 解析裡殘留的「前句才剛說 **A** 屬 Category 1」，
 * 以及 **我自己在第三輪寫進 `gist[532]` 的「故 A 為不正確之敘述」**。
 *
 * 判準必須夠精準，否則假陽性一片。實測過的三個版本：
 *   v1「任何裸 A–D」                 → 假陽性：`1.5°C`、`3–3.2°C`
 *   v2「前後有中文的裸 A–D」          → 假陽性：**優惠費率 A／B**（那是碳費費率等級的**正式名稱**，不是選項）
 *   v3「字母被當成主詞或受詞」+ 排除費率 → **3 筆真的、0 筆假陽性** ← 這個版本
 *
 * 「一個假陽性比真陽性還多的檢查器沒有價值。」判準寧可窄，不可吵。
 */
/**
 * 這些詞的後面接 A–D，是**正式名稱的一部分**，不是選項字母。
 *
 * 原本只在 regex 裡硬寫 `(?<!費率)` 一個例外（「優惠費率 A／B」是碳費費率等級的正式名稱）。
 * 後來寫「附錄 B 是應用指引」時整條 gate 就誤判了 —— 同一類例外，卻要再改一次 regex。
 * 改成一份清單：換題庫、換領域的人只要往這裡加詞，不必讀懂 lookbehind。
 */
export const LETTER_DESIGNATOR_PREFIXES: readonly string[] = [
  '費率', // 優惠費率 A／B —— 碳費費率等級的正式名稱
  '附錄', // 附錄 B 應用指引 —— IFRS 準則的附錄代號
  '附件', // 附件一國家 —— 京都議定書
  '附表', // 公告附表 A
  'Annex',
  'Appendix',
];

// 全程用 String.raw 組 regex 原文：普通字串與模板字串都會把 `\s` 當 identity escape
// 吃成字面 s，整條規則會安靜失效（我踩過兩次，兩次都是自我測試那條把它擋下來的）。
const notAfterDesignator = LETTER_DESIGNATOR_PREFIXES.map(
  (p) => '(?<!' + p + ')(?<!' + p + String.raw`\s` + ')'
).join('');

const LETTER_AS_OPTION = new RegExp(
  String.raw`(?:(?<=[說選把指])\s*[ABCD](?![A-Za-z0-9°])` +
    String.raw`|(?<![A-Za-z0-9°$])` +
    notAfterDesignator +
    String.raw`[ABCD]\s*(?=[屬是為則皆都]))`,
  'u'
);

export interface LetterRef {
  id: string;
  matched: string;
  /**
   * 命中的那個字母（只有「關鍵詞＋字母」這一式抽得出來）。
   *
   * 為什麼要回傳它：練習池那邊原本自己又寫了一份同樣的 pattern，就是為了拿到字母去跟
   * `answer` 對比 —— 那才抓到 `mock_rescued-050`「答案是 A，解析卻寫正解為 C」。
   * 兩份 pattern 寬窄不一（那份漏了「正解」，這份有），窄的那份就是洞。
   * 現在字母由這裡一起給出，pattern 只留一份。
   */
  letter?: string;
}

/** 找出解析裡所有「指涉選項字母」的寫法。 */
export function findLetterRefs(
  items: ReadonlyArray<{ id: string; explanation?: string | null }>
): LetterRef[] {
  const out: LetterRef[] = [];
  for (const it of items) {
    const ex = it.explanation ?? '';
    if (!ex) continue;
    for (const re of [KEYWORD_THEN_LETTER, BARE_LETTER_LIST, LETTER_AS_OPTION]) {
      const m = ex.match(re);
      if (m) out.push({ id: it.id, matched: m[0], letter: m[1] });
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
    '前句才剛說 A 屬 Category 1。',       // 單字母：mock-036 的殘留
    '故 A 為不正確之敘述。',              // 單字母：我自己在第三輪寫進 gist[532] 的
    '官方建議以 D 為最佳解。',
  ],
  shouldNotMatch: [
    '鍋爐燃料燃燒與自家車隊柴油屬範疇一；外購電力屬範疇二。',
    'ISO 14064-1 類別 4 是「來自組織使用的產品」之間接排放。',
    '依碳費收費辦法第 9 條，扣除比率為零點三。',
    'CO2 與 FM200 等氣體滅火器需要盤查。',   // 含 "2"、"200"，不可誤觸
    '附錄 B 是應用指引，產業別揭露要求另見該準則的產業別指引。',  // 附錄代號，非選項
    '碳權品質須符合 Annex B 之規定。',        // 英文附錄代號
    '事業適用優惠費率 A 者，應達行業別指定削減率。',  // 費率等級代號
    '將全球升溫控制在 1.5°C 的情境。',       // 「°C」不是選項 C
    '一般費率 NT$300，優惠費率 A 為 NT$50、優惠費率 B 為 NT$100。', // 費率等級的正式名稱
  ],
};
