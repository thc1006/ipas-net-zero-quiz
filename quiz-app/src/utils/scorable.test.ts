// 「能不能計分」的單一定義，以及全庫的不變量。
import { describe, it, expect } from 'vitest';
import { isQuestionScorable, whyNotScorable, SCORE_BLOCKING_FLAGS } from './scorable';
import dataset from '../data/integrated_dataset.json';
import pool from '../data/practice_pool.json';

describe('isQuestionScorable', () => {
  it('有答案且無阻斷旗標 → 可計分', () => {
    expect(isQuestionScorable({ answer: 'A' })).toBe(true);
    expect(isQuestionScorable({ answer: 'A', qualityFlags: ['time_sensitive'] })).toBe(true);
    // low_confidence 是練習池的品質提示（UI 已有徽章），不是「答案失效」
    expect(isQuestionScorable({ answer: 'A', qualityFlags: ['low_confidence'] })).toBe(true);
  });

  it('沒有答案 → 不可計分', () => {
    expect(isQuestionScorable({ answer: null })).toBe(false);
    expect(isQuestionScorable({ answer: undefined })).toBe(false);
    expect(isQuestionScorable({ hasAnswer: false, answer: 'A' })).toBe(false);
    expect(whyNotScorable({ answer: null })).toContain('沒有標準答案');
  });

  it.each(SCORE_BLOCKING_FLAGS)('帶 %s 旗標 → 即使有答案也不可計分', (flag) => {
    expect(isQuestionScorable({ answer: 'A', qualityFlags: [flag] })).toBe(false);
    expect(whyNotScorable({ answer: 'A', qualityFlags: [flag] })).toContain(flag);
  });

  it('多個旗標時，只要有一個是阻斷旗標就不可計分', () => {
    expect(
      isQuestionScorable({ answer: 'A', qualityFlags: ['time_sensitive', 'ambiguous'] })
    ).toBe(false);
  });
});

describe('全庫不變量：不得有「被判爭議卻仍可計分」的題目', () => {
  interface Item {
    index?: number;
    item_id?: string;
    id?: string;
    answer?: string | null;
    quality_flags?: string[];
  }
  const ds = dataset as unknown as { gist_items: Item[]; our_unique_items: Item[] };
  const pp = pool as unknown as { items: Item[] };
  const all: Item[] = [...ds.gist_items, ...ds.our_unique_items, ...pp.items];
  const who = (it: Item) => it.item_id ?? it.id ?? `gist-${it.index}`;

  it('母體夠大（這條 gate 不能空轉）', () => {
    expect(all.length).toBeGreaterThan(900);
  });

  it('帶阻斷旗標的題目，答案必須已被撤下（answer=null）', () => {
    // 先前這裡寫成「先用 isQuestionScorable 過濾、再看有沒有阻斷旗標」——
    // 帶旗標的題早就被第一道過濾掉，bad 永遠是空陣列，是一條空轉的 gate。
    // 真正該釘的是**資料層的一致性**：既然標了旗標代表我們無法背書這個答案，
    // 答案就該被撤下；否則哪天有人改了 predicate，答案又會悄悄回到計分池。
    const bad = all
      .filter((it) =>
        (it.quality_flags ?? []).some((f) =>
          (SCORE_BLOCKING_FLAGS as readonly string[]).includes(f)
        )
      )
      .filter((it) => it.answer !== null && it.answer !== undefined)
      .map((it) => `${who(it)}（旗標：${(it.quality_flags ?? []).join('、')}，答案仍為 ${it.answer}）`);
    expect(bad, '這些題目被標了爭議旗標，答案卻沒有撤下').toEqual([]);
  });

  it('沒有答案的題目一律不可計分', () => {
    const bad = all
      .filter((it) => it.answer === null || it.answer === undefined)
      .filter((it) => isQuestionScorable({ answer: it.answer, qualityFlags: it.quality_flags }))
      .map(who);
    expect(bad).toEqual([]);
  });
});

describe('計分路徑必須走同一支判斷', () => {
  it('useQuiz 不得自己 inline 過濾 hasAnswer', async () => {
    // 抽題、分母、統計散落五處。只要有人新增一種旗標卻漏改其中一處，
    // 就會出現「考試模式排除了、練習模式卻出現」這種不一致。
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/hooks/useQuiz.ts'),
      'utf8'
    );
    const inlined = src
      .split('\n')
      .map((line, i) => ({ line: line.trim(), no: i + 1 }))
      .filter(({ line }) => /\.filter\([^)]*\.hasAnswer|=>\s*q\.hasAnswer/.test(line));
    expect(
      inlined.map(({ no, line }) => `useQuiz.ts:${no}  ${line}`),
      '這些地方直接用 hasAnswer 過濾，請改用 isQuestionScorable()'
    ).toEqual([]);
    expect(src).toContain('isQuestionScorable');
  });
});
