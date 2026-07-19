// 題庫不得自相矛盾：同一個事實只能有一種說法
//
// 這道 gate 守的是一個**實際發生過、而且沒有任何東西看得到**的錯誤：
//
//   pool-aig-intl-020 的解析寫：「**我國環境部及 GHG Protocol 已採 AR6 數值**」
//
// 但環境部 113/2/5 公告的「溫室氣體排放係數」採的是 **AR5**
// （CH₄ = 28、化石源 CH₄ = 30、N₂O = 265）——
// 依 UNFCCC COP27 之結論，各國國家清冊自 2024 年起採 AR5。
//
// 而題庫裡其他題（mock-018、gist[480]、gist[494]、S_YAMOL_023-q079）**全都正確寫 AR5**。
// 也就是說：**同一份題庫對同一個事實給出兩種互相矛盾的答案。**
//
// 這對考生特別危險 —— iPAS 考的是我國制度，照那句話答題會答錯。
//
// 為什麼既有的 gate 都看不到：
//   - 法條引文 gate 只認 6 部我國法規；這句話不引法條
//   - 連結檢查只看 HTTP 狀態碼
//   - 「同題幹不同答案」的 gate 只比對**同一道題**，不比對**跨題的事實**
//
// 所以這裡登記「這個題庫對外主張的事實」，並檢查沒有任何一題與它牴觸。
// 事實會變（我國哪天改用 AR6 就要更新這張表）—— 所以每一筆都要寫 `as_of` 與出處。
import { describe, it, expect } from 'vitest';
import datasetRaw from './integrated_dataset.json';
import poolRaw from './practice_pool.json';

interface Q {
  id?: string;
  item_id?: string;
  index?: number;
  stem: string;
  explanation?: string | null;
  answer?: string | null;
  options: { key?: string; text: string }[];
}
const ds = datasetRaw as unknown as { gist_items: Q[]; our_unique_items: Q[] };
const ALL: Q[] = [
  ...ds.gist_items,
  ...ds.our_unique_items,
  ...(poolRaw as unknown as { items: Q[] }).items,
];
const who = (q: Q) => q.id ?? q.item_id ?? `gist[${q.index}]`;

/**
 * 「題庫對外主張的事實」= 題幹 + 解析 + **正確選項**。
 *
 * **干擾選項不能算進來。** 我第一版把四個選項全塞進去，結果 gate 抓到
 * pool-aig-ind-007 的干擾選項「一般費率每噸 100 元」——
 * 但那是**干擾項，本來就該是錯的**，那正是它存在的理由。
 * 一個會把「正確設計的干擾選項」判成「題庫說謊」的 gate，會逼人把題目出得更爛。
 */
const textOf = (q: Q) => {
  const correct = q.options.find((o) => o.key === q.answer)?.text ?? '';
  return `${q.stem}。${q.explanation ?? ''}。${correct}`;
};

interface CanonicalFact {
  /** 這個事實是什麼 */
  fact: string;
  /** 出處 */
  source: string;
  /** 查證到哪一天 */
  as_of: string;
  /** 題庫裡「必須至少有一題」這樣講 —— 否則這條登記是空的，gate 在空轉 */
  support: RegExp;
  /** 「絕對不可以」出現的說法 —— 出現就是自相矛盾 */
  contradiction: RegExp;
  /** 為什麼這個矛盾會害到考生 */
  harm: string;
}

const FACTS: readonly CanonicalFact[] = [
  {
    fact: '我國目前採用 IPCC AR5 的 100 年期 GWP（CH₄ = 28、化石源 CH₄ = 30、N₂O = 265），不是 AR6',
    source: '環境部 113/2/5 公告「溫室氣體排放係數」附表；依 UNFCCC COP27 結論，各國國家清冊自 2024 年起採 AR5',
    as_of: '2026-07-13',
    support: /(環境部|我國)[^。；]{0,40}(AR5|第五次評估)/u,
    // 「我國/環境部 …採/採用/改用… AR6」= 矛盾。
    // 注意：單純**介紹** AR6 的數值（如「IPCC AR6 的 CH₄ = 27.0」）是合法的，不能誤殺 ——
    // 所以主詞必須是我國/環境部，且動詞必須是「採用」類。
    contradiction: /(我國|環境部|臺灣|台灣)[^。；\n]{0,30}(已採|採用|改用|採行|使用)[^。；\n]{0,12}AR6/u,
    harm: 'iPAS 考的是我國制度。考生若相信「我國已採 AR6」，用 27.0 / 273 去算，答案會全錯。',
  },
  {
    fact: '碳費一般費率 NT$300／公噸 CO2e；優惠費率 A（行業別指定削減率）NT$50；優惠費率 B（技術標竿）NT$100',
    source: '環境部 113/10/07 費率審議會通過並公告',
    as_of: '2026-07-13',
    support: /一般費率[^。；]{0,10}300/u,
    // 一般費率若被寫成 50 / 100 / 500 以外的值 -> 矛盾
    contradiction: /一般費率[^。；\n]{0,10}(?!300)(50|100|200|500|1,?200)\s*元/u,
    harm: '費率是碳費計算題的輸入值，寫錯會讓所有碳費計算題的答案都錯。',
  },
  {
    fact: '碳費的 K 值（起徵差額）為 25,000 公噸 CO2e；高碳洩漏風險事業之 K 值為零',
    source: '《碳費收費辦法》§5（已釘選於 law-articles.pinned.json）',
    as_of: '2026-07-13',
    support: /K\s*值[^。；]{0,16}(25,?000|二萬五千|2\.5\s*萬)/u,
    contradiction: /K\s*值[^。；\n]{0,10}(?!25,?000|二萬五千|2\.5\s*萬|零|0\b)(10,?000|20,?000|50,?000|一萬|五萬)/u,
    harm: '同上 —— K 值錯，收費排放量就錯。',
  },
];

describe('題庫對同一個事實不得有兩種說法', () => {
  it.each(FACTS.map((f) => [f.fact, f] as const))(
    '「%s」—— 題庫裡確實有題目這樣講（否則這條登記是空轉）',
    (_name, f) => {
      const supporters = ALL.filter((q) => f.support.test(textOf(q))).map(who);
      expect(
        supporters.length,
        `沒有任何一題支持這個事實 —— 這條登記是空的，gate 在空轉。\n` +
          `出處：${f.source}`
      ).toBeGreaterThan(0);
    }
  );

  it.each(FACTS.map((f) => [f.fact, f] as const))(
    '「%s」—— 沒有任何題目與它牴觸',
    (_name, f) => {
      const bad = ALL.filter((q) => f.contradiction.test(textOf(q))).map((q) => {
        const m = textOf(q).match(f.contradiction);
        return `${who(q)}：出現「${m?.[0]}」`;
      });
      expect(
        bad,
        `題庫自相矛盾。\n` +
          `  正確的事實：${f.fact}\n` +
          `  出處：${f.source}（查證於 ${f.as_of}）\n` +
          `  為什麼要緊：${f.harm}`
      ).toEqual([]);
    }
  );

  it('每一筆登記都要寫出處與查證日期（事實會變，沒有日期就無從判斷是否過期）', () => {
    for (const f of FACTS) {
      expect(f.source, `「${f.fact}」沒寫出處`).toBeTruthy();
      expect(f.as_of, `「${f.fact}」沒寫查證日期`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(f.harm, `「${f.fact}」沒寫「矛盾會害到誰」`).toBeTruthy();
    }
  });

  // 變異測試：把「我國已採 AR6」寫回去，這道 gate 必須變紅。
  it('（變異測試）「我國環境部已採 AR6」一定會被抓到', () => {
    const mutant: Q = {
      id: 'MUTANT',
      stem: 'x',
      explanation: '我國環境部及 GHG Protocol 已採 AR6 數值。',
      options: [],
    };
    const ar5 = FACTS[0];
    expect(
      ar5.contradiction.test(textOf(mutant)),
      '變異樣本沒被抓到 —— 這道 gate 沒有牙齒'
    ).toBe(true);
  });

  it('（變異測試）單純介紹 AR6 的數值不會被誤殺', () => {
    const ok: Q = {
      id: 'CONTROL',
      stem: '依 IPCC AR6，CH₄（非化石源）之 100 年期 GWP 為何？',
      explanation: 'IPCC AR6 WG1 Table 7.15：CH₄ = 27.0、N₂O = 273。我國目前仍採 AR5。',
      options: [{ text: '27.0' }],
    };
    const ar5 = FACTS[0];
    expect(
      ar5.contradiction.test(textOf(ok)),
      '合法地介紹 AR6 數值被判成矛盾 —— 這道 gate 會逼人不敢寫 AR6 的題目'
    ).toBe(false);
  });
});
