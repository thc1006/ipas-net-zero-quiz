// 語料輪廓（content profile）—— 換題庫的人唯一需要重新產生的東西。
//
// 問題是什麼：這個 repo 有一批 CI 斷言把**本題庫的規模與分布**寫死，例如
// 「題幹引用條號的題目必須超過 20 題」、「主題庫必須超過 700 題」、
// 「無腦選最長的得分率不得高於 0.64」。它們對本題庫是對的 —— 那是在防止守門變成空轉；
// 但別人換上自己的題庫時，**第一天就全部紅**，而且散在十幾個檔案裡，不知道該改哪些。
//
// 為什麼用 Vitest 的 snapshot 而不是自己寫一份 profile JSON：
// 「committed baseline + 一個重新產生的指令」正是 snapshot 這個機制本身
// （`pnpm test:run -u`）。自己寫 JSON + 自己寫比對 = 重造 snapshot，
// 而且還要自己處理「baseline 不存在時怎麼辦」「怎麼更新」這些 snapshot 早就解好的事。
//
// 換題庫的流程因此變成：
//   1. 換上你的 integrated_dataset.json / practice_pool.json（通過 schemas/ 的驗證）
//   2. `pnpm test:run -u` 重新產生這份輪廓
//   3. 照下面「棘輪」那一節的清單，把只准往好的方向走的門檻重設為你的現況
//
// **棘輪刻意不放進 snapshot**：snapshot 的語意是「變了就更新」，而棘輪的語意是
// 「只准變好、變壞要紅」。把棘輪做成 snapshot 會讓它在退步時被一句 `-u` 抹掉。
import { describe, it, expect } from 'vitest';
import dataset from './integrated_dataset.json';
import pool from './practice_pool.json';
import { longestOptionScore, blatantLengthTells } from '../utils/answer-leakage';
import { DATA_QUALITY_FLAGS } from '../types/practicePool';

interface Item {
  answer?: string | null;
  exam_subject?: string;
  explanation?: string | null;
  quality_flags?: string[];
  metadata?: { evidence?: { quote?: string }[]; sources?: string[] };
  provenance?: { source_type?: string; evidence?: { quote?: string }[] };
  sources?: string[];
  options?: unknown[];
}
const DS = dataset as unknown as { gist_items: Item[]; our_unique_items: Item[]; meta: Record<string, unknown> };
const POOL = (pool as unknown as { items: Item[] }).items;
const MAIN = [...DS.gist_items, ...DS.our_unique_items];
const evidenceOf = (it: Item): { quote?: string }[] => [
  ...(it.metadata?.evidence ?? []),
  ...(it.provenance?.evidence ?? []),
];
const countBy = <T,>(xs: T[], key: (x: T) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const x of xs) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
};

describe('語料輪廓（換題庫時用 -u 重新產生）', () => {
  it('題庫規模與分布', () => {
    expect({
      主題庫: {
        總題數: MAIN.length,
        gist: DS.gist_items.length,
        還原題: DS.our_unique_items.length,
        有答案: MAIN.filter((i) => i.answer).length,
        有解析: MAIN.filter((i) => i.explanation).length,
        有引文: MAIN.filter((i) => evidenceOf(i).some((e) => (e.quote ?? '').length > 0)).length,
        依考科: countBy(MAIN, (i) => i.exam_subject ?? '(未分類)'),
      },
      練習池: {
        總題數: POOL.length,
        有答案: POOL.filter((i) => i.answer).length,
        有引文: POOL.filter((i) => evidenceOf(i).some((e) => (e.quote ?? '').length > 0)).length,
        依來源: countBy(POOL, (i) => i.provenance?.source_type ?? '(未標)'),
      },
      品質旗標: {
        詞彙量: DATA_QUALITY_FLAGS.length,
        主題庫使用次數: countBy(
          MAIN.flatMap((i) => i.quality_flags ?? []),
          (f) => f
        ),
        練習池使用次數: countBy(
          POOL.flatMap((i) => i.quality_flags ?? []),
          (f) => f
        ),
      },
    }).toMatchSnapshot();
  });

  it('答案洩漏指標', () => {
    const ai = POOL.filter((i) => i.provenance?.source_type === 'ai_generated');
    const mock = POOL.filter((i) => i.provenance?.source_type === 'external_mock');
    const pct = (x: { hit: number; n: number }): string =>
      x.n === 0 ? 'n/a' : `${((x.hit / x.n) * 100).toFixed(1)}%（${x.hit}/${x.n}）`;
    expect({
      '無腦選最長得分率': {
        'AI 產題': pct(longestOptionScore(ai as never)),
        '公開模擬題': pct(longestOptionScore(mock as never)),
        'gist': pct(longestOptionScore(DS.gist_items as never)),
        '還原題': pct(longestOptionScore(DS.our_unique_items as never)),
      },
      '露骨長度洩漏題數': {
        'AI 產題': blatantLengthTells(ai as never).length,
        'gist': blatantLengthTells(DS.gist_items as never).length,
        '還原題': blatantLengthTells(DS.our_unique_items as never).length,
      },
    }).toMatchSnapshot();
  });

  // 這一條不是 snapshot：它是給換題庫的人看的「你還需要手動重設哪些門檻」清單。
  // 放在這裡而不是散在十幾個檔案裡，是因為散著就沒人找得到。
  it('棘輪與反空轉門檻的清單（換題庫時需人工重設）', () => {
    const ratchets = [
      { where: 'answer-leakage.test.ts', what: 'AI 產題「選最長」得分率上限', semantics: '只准下降' },
      { where: 'clause-citation.test.ts', what: 'STEM_UNBOUND / EXPLANATION_UNBOUND 清冊與其上限', semantics: '只准變少' },
      { where: 'clause-citation.test.ts', what: '題幹／解析引用條號的最少題數（反空轉）', semantics: '依語料重設' },
      { where: 'scorable.test.tsx', what: '全庫母體下限（反空轉）', semantics: '依語料重設' },
      { where: 'bank-integrity.test.ts', what: '主題庫／練習池題數下限（反空轉）', semantics: '依語料重設' },
      { where: 'dataset-integrity.test.ts', what: 'CORRECTED_BUT_STABLE 等題號登記簿', semantics: '換題庫時清空重建' },
      { where: 'evidence-display.test.ts', what: '帶答案依據的題數下限（反空轉）', semantics: '依語料重設' },
      { where: 'docs-counts.test.ts', what: '文件數字對帳（由 tools/sync_derived_counts.py 維護）', semantics: '執行工具即可' },
    ];
    expect(ratchets.length).toBeGreaterThan(5);
    expect(ratchets).toMatchSnapshot();
  });
});
