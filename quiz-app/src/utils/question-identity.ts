// 「什麼算同一道題」—— 執行期與 CI **共用同一個定義**。
//
// 為什麼要抽出來：這裡原本有**兩套互相矛盾的定義**。
//
//   - CI 的重複檢查（dataset-integrity.test.ts）用 NFKC + 剝掉標點與分隔符。
//     它必須這麼狠，因為實測有 5 組重複是被標點遮住的：
//     U+2011 vs U+2013 的連字號、「」vs “”、臺 vs 台。
//
//   - 執行期的 dedupeByContent（questions.ts）只做 `.replace(/\s+/g, '')`
//     —— **只剝空白**。
//
// 也就是說：CI 擋得住的重複，使用者的考卷上照樣會出現兩次。
// gate 與執行期對「同一題」的定義不一致，等於 gate 只在 CI 裡是真的。
//
// 正規化的兩個地雷（都踩過）：
//   1. **不可以用 /[\s\W_]+/**。JS 的 \W 是 [^A-Za-z0-9_]，**中文字全部符合 \W**
//      —— 那會把題幹的中文整段刪光，剩下空殼互相「重複」，爆出一堆假警報。
//      （Python 的 \W 是 Unicode-aware，行為完全不同 —— 我就是這樣被騙的。）
//   2. **絕對不可以連 \p{S}（符號）一起剝**。× ÷ + − = 都是 \p{S}，
//      而題庫裡有公式題，四個選項的差別**只在運算子**：
//        A. 排放量 = 活動數據 × 排放係數 × GWP
//        C. 排放量 = 活動數據 ÷ 排放係數 × GWP
//      剝掉 \p{S} 之後它們會塌成同一個字串，於是「公式題答案錯在運算子」
//      這種錯誤會被判成「同一個答案」而放行 —— 一個親手做出來的、會漏掉錯誤的把關。

/** 題幹／選項的正規化：NFKC + 剝標點(\p{P})、分隔(\p{Z})、空白。保留 CJK 與符號。 */
export function normalizeText(t: string | null | undefined): string {
  return (t ?? '')
    .normalize('NFKC')
    .replace(/[\p{P}\p{Z}\s_]+/gu, '')
    .toLowerCase();
}

/** 一道題的內容指紋：題幹 + 選項集合（順序無關 —— 重排選項不會變成另一道題）。 */
export function contentSignature(q: {
  stem: string;
  options: readonly { text: string }[];
}): string {
  return (
    normalizeText(q.stem) +
    '||' +
    q.options
      .map((o) => normalizeText(o.text))
      .sort()
      .join('|')
  );
}

/**
 * 「計算題指紋」：題幹裡的數字集合 + 選項的數值集合。
 *
 * 為什麼需要第二種指紋：`contentSignature` 比對的是**文字**，
 * 題幹一被改寫就失效。實際踩到的：
 *
 *   主題庫 S1-p02-q004：「某工廠在一年內的能源使用情況如下： 使用電力 500,000 kWh
 *                        （每 kWh 電力產生 0.527 公斤二氧化碳）…」
 *   練習池 mock-058：   「某工廠一年能源使用：電力 500,000 kWh（係數 0.527 kgCO2/kWh）…」
 *
 * **同一道題**（六個輸入數字、四個選項數值、答案全部相同），只是被改寫過。
 * 文字指紋、甚至 3-gram 相似度（Jaccard 0.70）都抓不到 ——
 * 於是開啟「加強練習」後，同一份考卷可以出現同一題兩次。
 *
 * 但數字是改寫不掉的：一道計算題的**輸入**與**候選答案**就是它的身分。
 *
 * 只對「純數值題」有意義（四個選項都是數值答案），否則回 null ——
 * 散文選項裡的數字（CO2 的 2、IFRS S1/S2 的 1 和 2、100%）是雜訊，
 * 拿它們當指紋會製造大量假陽性。
 */
export function calcSignature(q: {
  stem: string;
  options: readonly { text: string }[];
}): string | null {
  const nums = (t: string) =>
    (t.replace(/[,，]/g, '').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

  if (!isNumericQuestion(q)) return null;
  const optVals = q.options.map((o) =>
    [...new Set(nums(o.text))].sort((a, b) => a - b).join(',')
  );

  const stemNums = [...new Set(nums(q.stem))].sort((a, b) => a - b);
  // 題幹至少要有兩個數字，才談得上「同一道計算題」
  if (stemNums.length < 2) return null;

  return `${stemNums.join(',')}||${[...optVals].sort().join(';')}`;
}

/**
 * 這個選項是不是「數值答案」（一個數字 + 單位），而不是散文。
 *
 * 判準：**把已知單位、數字、運算子剝掉之後，如果還剩下字，那就是散文。**
 *
 * 我第一版用的是「中文字 <= 6 個就算數值答案」，結果把這些都判成數值選項：
 *     「二氧化碳(CO2)」「100 % 減碳」「遠低於 2 °C」
 * —— 散文選項裡的**偶然數字**（CO2 的 2、100%、17 項）是雜訊，
 * 拿它們當數值指紋會製造大量假陽性（實測 10 筆全是假的）。
 *
 * 單位要**先剝**再剝數字：否則「60 公噸 CO2e」會先被拆成「公噸 COe」，
 * 單位就認不出來了。
 */
const UNITS =
  /公噸CO2e|公噸CO₂e|tCO2e|tCO₂e|CO₂e|CO2e|平方公尺|立方公尺|立方米|新臺幣|新台幣|公噸|公斤|公升|kWh|MWh|GWh|kW|kg|km|℃|°C|元|年|月|日|家|人|次|倍|萬|億|兆|噸|度|%|％/gu;

export function isNumericAnswer(text: string): boolean {
  const rest = text
    .replace(UNITS, '')
    .replace(/[\d.,，\s]/gu, '')
    .replace(/[+\-−×÷*/=()（）±≥≤<>~～約]/gu, '');
  return rest.length === 0;
}

/** 四個選項「全部」都是數值答案，這題才算純數值題。 */
export function isNumericQuestion(q: { options: readonly { text: string }[] }): boolean {
  return q.options.length > 0 && q.options.every((o) => isNumericAnswer(o.text));
}

/**
 * 求出一個數值選項的值。看得懂 `(a − b) × c [× d]` 這種算式 ——
 * 因為實際有選項寫成「(30,000 − 25,000) × 300 × 1 = 1,500,000 元」。
 * 看不懂就回 null（不猜）。
 */
export function optionValue(text: string): number | null {
  const s = text.replace(/[,，\s]/gu, '');
  // 減號兩種都要吃：ASCII hyphen 與 U+2212 MINUS SIGN（題庫裡兩種都有）。
  // `-` 放在字元類別**最後**，才不會被讀成範圍、也不必轉義（no-useless-escape）。
  const m = s.match(/\(?([\d.]+)[−-]([\d.]+)\)?[×x*]([\d.]+)(?:[×x*]([\d.]+))?/u);
  if (m) {
    const d = m[4] ? Number(m[4]) : 1;
    return (Number(m[1]) - Number(m[2])) * Number(m[3]) * d;
  }
  const n = s.match(/\d+(?:\.\d+)?/g);
  return n && n.length === 1 ? Number(n[0]) : null;
}

/** 依內容指紋去重（保留第一個出現的）。 */
export function dedupeByContent<T extends { stem: string; options: readonly { text: string }[] }>(
  qs: readonly T[]
): T[] {
  const seen = new Set<string>();
  return qs.filter((q) => {
    const sig = contentSignature(q);
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}
