// #128 只出官方題目：useQuiz 依 questionSource 抽題。
//
// 規格（issue #128）：開啟時每一題都帶官方標記；可與考科組合；官方題不夠時出實際有的題數，
// 不得補入非官方題；關閉時（'all' 或沒有這個欄位）行為與現在完全相同。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useQuiz } from './useQuiz';
import { allQuestions, getRandomQuestionsFromPool, getSourceCandidates } from '../data/questions';
import { officialSessions } from '../utils/question-source';
import type { QuizConfig } from '../types/quiz';
import {
  __resetPracticePoolCacheForTesting,
  __setPracticePoolForTesting,
} from '../utils/practice-pool';
import { buildFixturePool } from '../utils/__fixtures__/practice-pool-fixture';

const base: QuizConfig = {
  mode: 'practice',
  subject: 'all',
  questionCount: 20,
  shuffleQuestions: false,
  showAnswerImmediately: true,
};

// 固定亂數序列：同一個序列下，兩種寫法抽出的題目必須逐題相同
function seeded() {
  let x = 0x2545f491;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x100000000;
  });
}

function start(config: QuizConfig) {
  const { result } = renderHook(() => useQuiz());
  let started: boolean | undefined;
  act(() => {
    started = result.current.startQuiz(config);
  });
  return { result, started };
}

describe('useQuiz：只出官方題目', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('不隨機：照原卷順序出前 N 題，每一題都帶官方標記', () => {
    const { result, started } = start({ ...base, questionSource: 'official' });
    expect(started).toBe(true);
    const want = getSourceCandidates('all', 'official').slice(0, 20).map((q) => q.id);
    expect(result.current.questions.map((q) => q.id)).toEqual(want);
    expect(result.current.questions.filter((q) => !q.officialExam)).toEqual([]);
  });

  it('隨機：N 題、不重複、全部取自官方題', () => {
    const { result } = start({ ...base, questionSource: 'official', shuffleQuestions: true });
    const ids = result.current.questions.map((q) => q.id);
    const pool = new Set(getSourceCandidates('all', 'official').map((q) => q.id));
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
    expect(ids.filter((id) => !pool.has(id))).toEqual([]);
  });

  // 隨機是預設值：退化成永遠照原卷順序的話，每個人每次都拿到第一場第一科的前 20 題
  it('隨機：用主題庫同一套洗牌（固定亂數下逐題相同），不是原卷順序', () => {
    const candidates = getSourceCandidates('all', 'official');
    seeded();
    const want = getRandomQuestionsFromPool(candidates, 20, 'all', true).map((q) => q.id);
    vi.restoreAllMocks();
    seeded();
    const { result } = start({ ...base, questionSource: 'official', shuffleQuestions: true });
    const got = result.current.questions.map((q) => q.id);
    expect(got).toEqual(want);
    expect(got).not.toEqual(candidates.slice(0, 20).map((q) => q.id));
  });

  it('可與考科、場次組合；官方題不夠時出實際有的題數，不補非官方題', () => {
    const [session] = officialSessions(allQuestions);
    const candidates = getSourceCandidates('考科2', `exam:${session}`);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThan(100);
    const { result } = start({
      ...base,
      subject: '考科2',
      questionSource: `exam:${session}`,
      questionCount: 100,
    });
    expect(result.current.questions.map((q) => q.id)).toEqual(candidates.map((q) => q.id));
    expect(
      result.current.questions.filter(
        (q) => q.subject !== '考科2' || q.officialExam?.session !== session
      )
    ).toEqual([]);
  });

  it('一題都沒有時不開始測驗（回傳 false；App 依此留在原頁，見 App.test.tsx）', () => {
    const { result, started } = start({ ...base, questionSource: 'exam:999-01' });
    expect(started).toBe(false);
    expect(result.current.isActive).toBe(false);
    expect(result.current.questions).toEqual([]);
  });
});

describe("useQuiz：'all' 與沒有 questionSource 時行為完全相同", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const shuffleQuestions of [true, false]) {
    for (const subject of ['all', '考科1', '考科2'] as const) {
      it(`shuffle=${shuffleQuestions}、${subject}`, () => {
        seeded();
        const without = start({ ...base, subject, shuffleQuestions, questionCount: 40 });
        vi.restoreAllMocks();
        seeded();
        const withAll = start({ ...base, subject, shuffleQuestions, questionCount: 40, questionSource: 'all' });
        const a = without.result.current.questions.map((q) => q.id);
        expect(a).toHaveLength(40);
        expect(withAll.result.current.questions.map((q) => q.id)).toEqual(a);
        expect(without.started).toBe(true);
        expect(withAll.started).toBe(true);
      });
    }
  }
});

describe('useQuiz.startQuizWithPool：只出官方題目時不混練習池', () => {
  beforeEach(() => {
    __setPracticePoolForTesting(buildFixturePool());
  });
  afterEach(() => {
    __resetPracticePoolCacheForTesting();
    vi.restoreAllMocks();
  });

  async function startWithPool(config: QuizConfig) {
    const { result } = renderHook(() => useQuiz());
    let started: boolean | undefined;
    await act(async () => {
      started = await result.current.startQuizWithPool({ ...config, includePracticePool: true });
    });
    return { result, started };
  }

  // 練習池啟用時走這一條；手邊有練習題可以混，正是最容易「悄悄補題」的地方
  it('官方題不夠時只出實際有的題數，不拿練習池或主題庫的題目補', async () => {
    const [session] = officialSessions(allQuestions);
    const candidates = getSourceCandidates('考科2', `exam:${session}`);
    expect(candidates.length).toBeLessThan(100);
    const { result, started } = await startWithPool({
      ...base,
      subject: '考科2',
      questionSource: `exam:${session}`,
      questionCount: 100,
    });
    expect(started).toBe(true);
    expect(result.current.questions.map((q) => q.id)).toEqual(candidates.map((q) => q.id));
  });

  it('隨機：與 startQuiz 同一套洗牌（固定亂數下逐題相同），不是原卷順序', async () => {
    const candidates = getSourceCandidates('all', 'official');
    seeded();
    const want = getRandomQuestionsFromPool(candidates, 20, 'all', true).map((q) => q.id);
    vi.restoreAllMocks();
    seeded();
    const { result } = await startWithPool({ ...base, questionSource: 'official', shuffleQuestions: true });
    const got = result.current.questions.map((q) => q.id);
    expect(got).toEqual(want);
    expect(got).not.toEqual(candidates.slice(0, 20).map((q) => q.id));
  });

  it('includePracticePool 為 true 也只出官方題', async () => {
    const { result } = renderHook(() => useQuiz());
    let started: boolean | undefined;
    await act(async () => {
      started = await result.current.startQuizWithPool({
        ...base,
        questionSource: 'official',
        includePracticePool: true,
        questionCount: 50,
      });
    });
    expect(started).toBe(true);
    expect(result.current.questions).toHaveLength(50);
    expect(result.current.questions.filter((q) => q.sourceType === 'practice_pool')).toEqual([]);
    expect(result.current.questions.filter((q) => !q.officialExam)).toEqual([]);
  });

  it('一題都沒有時不開始測驗（回傳 false），也不會改用練習池補題', async () => {
    const { result } = renderHook(() => useQuiz());
    let started: boolean | undefined;
    await act(async () => {
      started = await result.current.startQuizWithPool({
        ...base,
        questionSource: 'exam:999-01',
        includePracticePool: true,
      });
    });
    expect(started).toBe(false);
    expect(result.current.isActive).toBe(false);
    expect(result.current.questions).toEqual([]);
  });
});
