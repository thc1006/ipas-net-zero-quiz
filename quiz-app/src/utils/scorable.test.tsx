// 「能不能計分」的單一定義，以及全庫的不變量。
import { describe, it, expect } from 'vitest';
import { isQuestionScorable, whyNotScorable, SCORE_BLOCKING_FLAGS } from './scorable';
import dataset from '../data/integrated_dataset.json';
import pool from '../data/practice_pool.json';
import type { QuizQuestion } from '../types/quiz';
import type { PracticePoolQualityFlag } from '../types/practicePool';
import { ADVISORY_QUALITY_FLAGS } from '../types/practicePool';
import { validatePracticePool } from './practice-pool-schema';
import { toQuizQuestion } from './practice-pool';

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
    // 標註成 QuizQuestion：fixture 自己就受真型別檢查，避免造出一個現實中不存在的形狀
    const mk = (id: string, flags: PracticePoolQualityFlag[] = []): QuizQuestion => ({
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

// 這一組是本檔最重要的守門：阻斷旗標必須「標得下去」，而且「標了真的會離開計分池」。
//
// 為什麼：SCORE_BLOCKING_FLAGS 原本是在 scorable.ts 手寫的第二份清單，而資料檔的合法值
// 由 practice-pool-schema 的另一份白名單決定 —— 兩份的交集只有 ambiguous。
// 也就是說，照本模組宣稱的用法把一題標成 disputed，schema 會判該題非法、CI 直接紅：
// 這個承諾對 6 個旗標中的 5 個根本不成立。單測 isQuestionScorable() 永遠驗不到這件事，
// 因為它只吃自己造的物件、繞過了資料層。
describe('阻斷旗標必須在資料層可用（不是只有 predicate 認得）', () => {
  const sample = (pool as { items: unknown[] }).items[0] as Record<string, unknown>;

  it.each([...SCORE_BLOCKING_FLAGS])('practice_pool schema 接受阻斷旗標 %s', (flag) => {
    const doc = { ...(pool as object), items: [{ ...sample, quality_flags: [flag] }] };
    const flagErrors = validatePracticePool(doc).filter((e) =>
      e.path.includes('quality_flags')
    );
    expect(
      flagErrors,
      `schema 不接受 ${flag} —— 標上它會讓該題被判非法，而不是離開計分池`
    ).toEqual([]);
  });

  it.each([...SCORE_BLOCKING_FLAGS])(
    '帶 %s 的池題經 toQuizQuestion 後不可計分',
    (flag) => {
      const item = { ...sample, quality_flags: [flag] } as Parameters<typeof toQuizQuestion>[0];
      expect(isQuestionScorable(toQuizQuestion(item))).toBe(false);
    }
  );

  it.each([...ADVISORY_QUALITY_FLAGS])('帶 %s 的池題仍可計分（提示型旗標不阻斷）', (flag) => {
    const item = { ...sample, quality_flags: [flag] } as Parameters<typeof toQuizQuestion>[0];
    expect(isQuestionScorable(toQuizQuestion(item))).toBe(true);
  });
});

// 「離開計分池」如果使用者看不見，那只做完一半。
//
// 標了 disputed 的題目答案會被撤下（見上面的資料層不變量），於是畫面上會出現
// 一題沒有標準答案的題目。若徽章與提示都不提它，使用者只會覺得「這題壞了」。
// 兩張說明表都對資料層詞彙窮舉（Record 而非 Partial<Record>），tsc 會強制新旗標補說明；
// 這裡再從**渲染結果**確認一次 —— 型別窮舉保證鍵存在，不保證它真的被畫出來。
describe('失效型旗標必須在畫面上說得出來', () => {
  it.each([...SCORE_BLOCKING_FLAGS])('SourceBadge 會顯示 %s 的徽章', async (flag) => {
    const { render, screen, cleanup } = await import('@testing-library/react');
    const { SourceBadge } = await import('../components/SourceBadge/SourceBadge');
    cleanup();
    render(
      <SourceBadge sourceType="ai_generated" qualityFlags={[flag]} />
    );
    const chip = document.querySelector(`.flag-${flag}`);
    expect(chip, `${flag} 沒有渲染出徽章 —— 題目離開計分池了，使用者卻看不到原因`).not.toBeNull();
    expect(chip?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    expect(screen).toBeTruthy();
  });

  it.each([...SCORE_BLOCKING_FLAGS])('SourceBanner 的 %s 提示會說明不列入計分', async (flag) => {
    const { render, screen, cleanup } = await import('@testing-library/react');
    const { SourceBanner } = await import('../components/SourceBanner/SourceBanner');
    cleanup();
    render(<SourceBanner sourceType="ai_generated" qualityFlags={[flag]} sourceCount={1} />);
    expect(screen.getByText(/不列入計分/)).toBeInTheDocument();
  });
});
