// 跨題庫的完整性 —— 主題庫與練習池「合起來看」才會出現的問題。
//
// 這個檔案存在的理由：每一道既有的 gate 都只看**一個**題庫。
// 但使用者開啟「加強練習」時，抽題是從**合併後的池子**抽的 ——
// 只有在合併之後才存在的錯誤，沒有任何一道 gate 看得到。
//
// 實際抓到的：
//
//   主題庫 S1-p02-q004：「某工廠在一年內的能源使用情況如下： 使用電力 500,000 kWh
//                        （每 kWh 電力產生 0.527 公斤二氧化碳）…」
//   練習池 mock-058：   「某工廠一年能源使用：電力 500,000 kWh（係數 0.527 kgCO2/kWh）…」
//
// **同一道題** —— 六個輸入數字、四個選項數值、答案全部相同，只是題幹被改寫過。
// 於是開啟「加強練習」後，同一份考卷真的可能出現同一題兩次。
//
// 而且**沒有任何東西看得到它**：
//   - 執行期的 dedupeByContent 比對題幹文字 → 題幹被改寫，抓不到
//   - 3-gram 相似度（Jaccard 0.70）→ 抓不到
//   - 兩個題庫各自的重複檢查 → 根本不會跨庫比
//
// 但數字是改寫不掉的：一道計算題的**輸入**與**候選答案**就是它的身分。
import { describe, it, expect } from 'vitest';
import datasetRaw from './integrated_dataset.json';
import poolRaw from './practice_pool.json';
import {
  contentSignature,
  calcSignature,
  isNumericQuestion,
  optionValue,
} from '../utils/question-identity';

interface Q {
  id?: string;
  item_id?: string;
  index?: number;
  stem: string;
  options: { key: string; text: string }[];
  answer?: string | null;
}
const ds = datasetRaw as unknown as { gist_items: Q[]; our_unique_items: Q[] };
const MAIN = [...ds.gist_items, ...ds.our_unique_items];
const POOL = (poolRaw as unknown as { items: Q[] }).items;
const who = (q: Q) => q.id ?? q.item_id ?? `gist[${q.index}]`;

describe('跨題庫：同一道題不得同時存在於主題庫與練習池', () => {
  it('內容指紋（題幹 + 選項集合）不得重複', () => {
    const mainSigs = new Map(MAIN.map((q) => [contentSignature(q), who(q)]));
    const dup = POOL.filter((q) => mainSigs.has(contentSignature(q))).map(
      (q) => `${q.id} 與主題庫的 ${mainSigs.get(contentSignature(q))} 是同一題`
    );
    expect(dup).toEqual([]);
  });

  // 文字指紋抓不到被改寫的題目 —— 這條才是抓到 mock-058 的那一條。
  it('計算題指紋（題幹數字 + 選項數值）不得重複', () => {
    const mainCalc = new Map<string, string>();
    for (const q of MAIN) {
      const s = calcSignature(q);
      if (s) mainCalc.set(s, who(q));
    }
    expect(
      mainCalc.size,
      '主題庫一道計算題都沒認出來 —— calcSignature 壞了，這條測試在空轉'
    ).toBeGreaterThan(5);

    const dup = POOL.map((q) => ({ q, s: calcSignature(q) }))
      .filter((x) => x.s && mainCalc.has(x.s))
      .map(
        (x) =>
          `${x.q.id} 與主題庫的 ${mainCalc.get(x.s!)} 是同一道計算題` +
          `（輸入數字與四個選項的數值完全相同，只是題幹被改寫）`
      );
    expect(
      dup,
      '開啟「加強練習」後，同一份考卷會出現同一題兩次 —— ' +
        '執行期的 dedupeByContent 比對的是題幹文字，題幹被改寫就抓不到'
    ).toEqual([]);
  });

  // 變異測試：把改寫過的重複題塞回去，這道 gate 必須變紅。
  it('（變異測試）被改寫過的重複題一定會被抓到', () => {
    const target = MAIN.find((q) => calcSignature(q) != null);
    expect(target, '找不到任何計算題可做變異').toBeDefined();

    // 把題幹徹底改寫（文字完全不同），但輸入數字與選項不動 —— 就是 mock-058 的樣子
    const nums = target!.stem.match(/[\d,]+(?:\.\d+)?/g) ?? [];
    const rewritten: Q = {
      id: 'MUTANT',
      stem: `完全改寫過的題幹，數據如下：${nums.join(' / ')}，請計算。`,
      options: target!.options,
    };
    expect(calcSignature(rewritten)).toBe(calcSignature(target!));
  });
});

describe('數值題不得有兩個選項是同一個答案', () => {
  // 實際抓到的（pool-em-ipas_vocus_mock-052，缺陷來自來源）：
  //     A. 1,500,000 元
  //     C. (30,000 − 25,000) × 300 × 1 = 1,500,000 元   ← 來源標的答案
  // **A 與 C 是同一個答案。** 算出 1,500,000 然後選 A 的考生會被判錯 ——
  // 而 A 在數值上完全正確。這是一道有兩個正解的瑕疵題。
  //
  // 既有的「同題內重複選項」檢查抓不到它：兩者的**文字**不同（一個列了算式）。
  // 缺陷在**數值**層，不在文字層。
  const check = (items: Q[]) => {
    const bad: string[] = [];
    let scanned = 0;
    for (const q of items) {
      if (!isNumericQuestion(q)) continue;
      const vals = q.options.map((o) => optionValue(o.text));
      if (vals.some((v) => v == null)) continue;
      scanned++;
      for (let i = 0; i < vals.length; i++) {
        for (let j = i + 1; j < vals.length; j++) {
          if (vals[i] === vals[j]) {
            bad.push(
              `${who(q)}：選項 ${q.options[i].key}「${q.options[i].text}」與 ` +
                `${q.options[j].key}「${q.options[j].text}」是同一個數值（${vals[i]}）`
            );
          }
        }
      }
    }
    return { bad, scanned };
  };

  it('主題庫', () => {
    const { bad, scanned } = check(MAIN);
    expect(scanned, '一道數值題都沒認出來 —— 這條測試在空轉').toBeGreaterThan(5);
    expect(bad, '有兩個選項是同一個答案 —— 選對數值卻選錯字母的考生會被判錯').toEqual([]);
  });

  it('練習池', () => {
    const { bad, scanned } = check(POOL);
    expect(scanned).toBeGreaterThan(3);
    expect(bad).toEqual([]);
  });
});

// 練習池的「數值答案」必須逐題被登記。
//
// 主題庫早就有計算題的手算回歸表（21 題），**練習池是零** —— 又一次「守了一半」。
//
// 兩件事刻意不做：
//
// 1. **不寫算式 parser。** 主題庫那邊我寫過三個，三個都錯：
//    漏掉中間的排放係數、GWP 的 regex 被「IPCC AR5」裡的 5 擋住、處理不了多來源加總。
//    一個會算錯的 parser 比沒有 parser 更糟 —— 它會理直氣壯地放行錯的答案。
//
// 2. **不用關鍵字猜「這題是算術還是查表」。** 我試過 /計算|合計|應繳/，
//    結果把「其碳費『計算』之係數為？」「年排放量『合計』值達多少？」
//    這種查表題也抓了進來 —— 機械上分不出來。
//
// 所以：**每一道數值題都必須被人工登記**，要嘛是 CALC（附手算），
// 要嘛是 LOOKUP（附出處）。分類由人做，不是由 regex 猜。
// 沒登記的題目會讓 CI 紅 —— 逼下一個加題目的人回來算一次、或寫下依據。
describe('練習池：每一道數值題都必須被登記（算術題手算、查表題附出處）', () => {
  /** 算術題：答案是由題幹的數字算出來的。逐題手算，把結果釘在這裡。 */
  const CALC: ReadonlyArray<{ id: string; expect: string; math: string }> = [
    {
      id: 'pool-em-ipas_vocus_mock-051',
      expect: '60 公噸 CO2e',
      math: '100 公噸水泥 × (直接 0.5 + 間接 0.1) = 60（CBAM 對水泥須申報直接＋間接內含碳排）',
    },
    {
      id: 'pool-em-ipas_vocus_mock-052',
      expect: '1,500,000 元',
      math: '(年排放 30,000 − K值 25,000) × 調整係數 1 × 一般費率 300 = 1,500,000',
    },
  ];

  /**
   * 查表題：答案不是算出來的，是某份文件寫的。`basis` 必須指出「哪份文件的哪一條」。
   * 標 ✅ 的已用 law-articles.pinned.json 的逐字原文核對過。
   */
  const LOOKUP: ReadonlyArray<{ id: string; expect: string; basis: string }> = [
    // ── 已用釘選的法條原文逐字核對 ✅ ────────────────────────────────
    { id: 'pool-em-ipas_vocus_mock-016', expect: '10月31日', basis: '✅ 溫管辦法 §9：「應於每年十月三十一日前…上傳」' },
    { id: 'pool-em-ipas_vocus_mock-020', expect: '10%', basis: '✅ 碳費收費辦法 §9：國內減量額度「扣除上限不得超過…百分之十」' },
    { id: 'pool-em-ipas_vocus_mock-053', expect: '0.2', basis: '✅ 碳費收費辦法 §6：「第一期排放量調整係數值為零點二」' },
    { id: 'pool-aig-tw_regs_00-v2', expect: '2.5 萬公噸', basis: '✅ 碳費收費辦法 §3：「年排放量合計值達二萬五千公噸二氧化碳當量以上」' },
    { id: 'pool-aig-tw_regs_03-v2', expect: '0.2', basis: '✅ 碳費收費辦法 §6 第一款' },
    { id: 'pool-aig-tw_regs_05-v2', expect: '2.5 萬公噸', basis: '✅ 碳費收費辦法 §5：「K值為二萬五千公噸二氧化碳當量」' },
    { id: 'pool-aig-tw_regs_06-v2', expect: '5 月 31 日', basis: '✅ 碳費收費辦法 §4：「每年五月底前…自行計算應繳納之費額」' },
    { id: 'pool-aig-tw_regs_15-v2', expect: '± 5%', basis: '✅ 溫管辦法 §15 第五款：「差異達百分之五以上」' },
    { id: 'pool-aig-tw_regs_24-v2', expect: '1,000 平方公尺', basis: '✅ 建築物設置太陽光電發電設備標準（內政部經濟部令 114/12/19 訂定，115/08/01 施行）' },

    // ── 依環境部／主管機關公告（不在法規資料庫，靠公告核對）────────────
    { id: 'pool-em-ipas_vocus_mock-003', expect: '28 ± 2%', basis: '環境部第三期階段管制目標：2030 年較 2005 年減 28±2%（NDC 3.0）' },
    { id: 'pool-em-ipas_vocus_mock-004', expect: '50元', basis: '環境部 113/10/07 公告碳費費率：優惠費率 A = NT$50' },
    { id: 'pool-aig-tw_regs_01-v2', expect: '300 元', basis: '環境部 113/10/07 公告碳費費率：一般費率 = NT$300' },
    { id: 'pool-aig-tw_regs_35-v2', expect: '50 元', basis: '環境部 113/10/07 公告碳費費率：優惠費率 A（行業別指定削減率）= NT$50' },
    { id: 'pool-aig-tw_regs_07-v2', expect: '2030 年', basis: '環境部「碳費徵收對象溫室氣體減量指定目標」公告：目標年 2030' },
    { id: 'pool-em-ipas_vocus_mock-014', expect: '2025年7月1日', basis: '環境部 114/02/25 公告 HFCs 列管：自 114/7/1（2025/7/1）起未經核准不得輸出入' },
    { id: 'pool-em-ipas_vocus_mock-015', expect: '2026年，4月30日', basis: '⚠️ 依溫管辦法「修正草案」（尚未發布施行）；4/30 期限本身是現行 §6 明文' },
    { id: 'pool-aig-ind-002', expect: '2027 年', basis: '金管會「上市櫃公司永續發展路徑圖 2.0」：全體上市櫃完成範疇 1+2 盤查最遲 2027' },
    { id: 'pool-aig-ind-005', expect: '2024 年 10 月 21 日', basis: '臺灣碳權交易所國內減量額度交易平台 2024/10/21 啟用（中央社 202410210205「今天啟用」、首批 6 專案；原題選項誤植 10/2 已更正）' },
    { id: 'pool-aig-ind-029', expect: '≤ 1.6', basis: '行政院「資料中心設置作業要點」第九點：民國 106/1/9（2017/1/9）起新建置者 PUE 應低於 1.6' },

    // ── 國際準則 ───────────────────────────────────────────────────
    { id: 'pool-em-ipas_vocus_mock-009', expect: '1.5°C', basis: 'SBTi 近期目標自 2022 年起一律要求 1.5°C 對齊路徑' },
    { id: 'pool-aig-ind-016', expect: '≥ 40%', basis: 'SBTi Corporate Near-Term Criteria：範疇 3 達總排放 40% 以上須設範疇 3 目標' },

    // ── 統計數字（會逐年變動，已標 time_sensitive）────────────────────
    { id: 'pool-em-ipas_vocus_mock-010', expect: '4兆元', basis: '國發會 2050 淨零路徑：2030 年前政府投入 9,000 億元，帶動民間約 4 兆元' },
    { id: 'pool-aig-ind-012', expect: '約 68%', basis: '⚠️ 能源署統計：2024 年底太陽光電占再生能源裝置容量 67.8%（逐年變動）' },
  ];

  const byId = new Map(POOL.map((q) => [q.id!, q]));
  const answerOf = (id: string) => {
    const q = byId.get(id);
    if (!q) return null;
    return q.options.find((o) => o.key === q.answer)?.text ?? '(無答案)';
  };
  const norm = (s: string) => s.replace(/[\s,，]/g, '');

  it('算術題：標準答案與手算結果相符', () => {
    const bad = CALC.filter((c) => {
      const ans = answerOf(c.id);
      return ans == null || !norm(ans).includes(norm(c.expect));
    }).map((c) => `${c.id}：標準答案是「${answerOf(c.id)}」，手算結果是「${c.expect}」（${c.math}）`);
    expect(bad).toEqual([]);
  });

  it('查表題：標準答案與登記的出處相符，且每一筆都寫了依據', () => {
    const bad: string[] = [];
    for (const l of LOOKUP) {
      const ans = answerOf(l.id);
      if (ans == null) {
        bad.push(`${l.id} 不存在 —— 登記表有殘留`);
        continue;
      }
      if (!l.basis) bad.push(`${l.id} 沒寫依據`);
      if (!norm(ans).includes(norm(l.expect))) {
        bad.push(`${l.id}：標準答案是「${ans}」，但登記的是「${l.expect}」（${l.basis}）`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('沒有任何數值題漏登記（新增數值題必須一起算／查，然後登記）', () => {
    const registered = new Set([...CALC.map((c) => c.id), ...LOOKUP.map((l) => l.id)]);
    const missing = POOL.filter(isNumericQuestion)
      .filter((q) => !registered.has(q.id!))
      .map((q) => `${q.id}：${q.stem.slice(0, 44)}…`);
    expect(
      missing,
      '有數值題沒被登記。**不要寫 parser、也不要用關鍵字猜它是算術還是查表** ——\n' +
        '人工算一次（登進 CALC）或查一次出處（登進 LOOKUP）。'
    ).toEqual([]);
  });

  it('登記表不得有殘留（列了卻已不存在的題目 = 記錄與事實不符）', () => {
    const ghosts = [...CALC.map((c) => c.id), ...LOOKUP.map((l) => l.id)].filter(
      (id) => !byId.has(id)
    );
    expect(ghosts).toEqual([]);
  });
});
