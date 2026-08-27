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

describe('抽題 helper 必須真的排除不可計分的題（行為測試）', () => {
  // 先前只有一條掃 useQuiz.ts 原始碼的 static gate —— 它剛好漏掉真正做過濾的
  // questions.ts helpers（#96 把 hasAnswer 邏輯集中到那裡）。
  // 結果是 gate 全綠，但預設的隨機抽題路徑仍走舊判斷：
  // 一題 answer='A' + ambiguous 仍可能進考卷，而分母把它排除 → 分數可能超過 100。
  it('getRandomQuestionsFromPool 不會回傳「有答案但帶阻斷旗標」的題', async () => {
    const { getRandomQuestionsFromPool } = await import('../data/questions');
    const mk = (id: string, flags: string[] = []) => ({
      id,
      stem: `題幹 ${id}`,
      options: [
        { key: 'A', text: '甲' },
        { key: 'B', text: '乙' },
      ],
      answer: 'A',
      subject: '考科1' as const,
      sourceType: 'gist' as const,
      year: null,
      hasAnswer: true,
      qualityFlags: flags,
    });
    const pool = [
      mk('ok-1'),
      mk('ok-2'),
      mk('blocked-1', ['ambiguous']),
      mk('blocked-2', ['retired']),
      mk('advisory', ['time_sensitive']),
    ];
    const picked = getRandomQuestionsFromPool(pool, 10, 'all', true);
    const ids = picked.map((q) => q.id);
    expect(ids).not.toContain('blocked-1');
    expect(ids).not.toContain('blocked-2');
    // time_sensitive 只是提醒，不該被排除
    expect(ids).toContain('advisory');
    expect(ids.length).toBe(3);
  });

  it('主題庫的 quality_flags 一路帶到 runtime（converter 先前把它丟掉）', async () => {
    const { allQuestions } = await import('../data/questions');
    const flagged = allQuestions.filter(
      (q) => (q.qualityFlags ?? []).length > 0
    );
    expect(
      flagged.length,
      '主題庫 raw data 有 quality_flags，但 runtime 一題都沒有 —— converter 又把它丟了'
    ).toBeGreaterThan(100);
    expect(flagged.some((q) => (q.qualityFlags ?? []).includes('time_sensitive'))).toBe(true);
  });

  it('全庫的可計分題都通過 predicate（分母與抽題同一口徑）', async () => {
    const { questionsWithAnswer, allQuestions } = await import('../data/questions');
    expect(questionsWithAnswer.every((q) => isQuestionScorable(q))).toBe(true);
    expect(questionsWithAnswer.length).toBeLessThanOrEqual(allQuestions.length);
    expect(questionsWithAnswer.length).toBeGreaterThan(700);
  });
});
