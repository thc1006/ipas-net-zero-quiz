// #128 只出官方題目：useQuiz 依 questionSource 抽題。
//
// 規格（issue #128）：開啟時每一題都帶官方標記；可與考科組合；官方題不夠時出實際有的題數，
// 不得補入非官方題；關閉時（'all' 或沒有這個欄位）行為與現在完全相同。
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useQuiz } from './useQuiz';
import { allQuestions, getRandomQuestionsFromPool, getSourceCandidates } from '../data/questions';
import { officialSessions, sampleEditions } from '../utils/question-source';
import type { QuizConfig, QuizQuestion } from '../types/quiz';
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
    expect(result.current.questions.filter((q) => !q.officialExam && !q.officialSample)).toEqual([]);
    // 原卷順序從最早的一份開始：114 年版的參考樣題排在 115 年的公告試題之前
    expect(result.current.questions[0].officialSample?.edition).toBe('114');
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

  it('可與考科、版次組合：只出那一版參考樣題的那一科，題數不夠時出實際有的題數', () => {
    const [edition] = sampleEditions(allQuestions);
    const candidates = getSourceCandidates('考科1', `sample:${edition}`);
    expect(candidates.length).toBeGreaterThan(0);
    const { result } = start({ ...base, subject: '考科1', questionSource: `sample:${edition}`, questionCount: 100 });
    expect(result.current.questions.map((q) => q.id)).toEqual(candidates.map((q) => q.id));
    expect(
      result.current.questions.filter((q) => q.subject !== '考科1' || q.officialSample?.edition !== edition)
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
    expect(result.current.questions.filter((q) => !q.officialExam && !q.officialSample)).toEqual([]);
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

describe('useQuiz.resumeQuiz：題目來源', () => {
  const STORAGE_KEY = 'ipas-quiz-in-progress-v2';

  // 還原真實 localStorage（test-setup.ts mock 成空函式）
  beforeAll(() => {
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (k: string): string | null => store.get(k) ?? null,
        setItem: (k: string, v: string): void => { store.set(k, v); },
        removeItem: (k: string): void => { store.delete(k); },
        clear: (): void => { store.clear(); },
        key: (i: number): string | null => Array.from(store.keys())[i] ?? null,
        get length(): number { return store.size; },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  // 官方題日後被拿掉標記、場次改了，進度裡就會有不屬於這個來源的題目。整份放棄的話，作答 60 題的進度
  // 在首頁一載入就沒了，也沒有任何提示。比照無答案題，只拿掉那幾題
  describe('進度裡有題目不屬於這個來源', () => {
    const [officialA, officialB, officialC] = getSourceCandidates('all', 'official');
    const gist = allQuestions.find((q) => q.id === 'gist-1')!;
    const ids = (questions: readonly { id: string }[]) => questions.map((q) => q.id);
    const answer = (q: QuizQuestion) => ({
      questionId: q.id,
      selectedAnswer: q.answer,
      correctAnswer: q.answer,
      isCorrect: true,
      timeSpent: 1,
      timestamp: 1,
      sourceCategory: 'main_bank',
    });

    function resumeFrom(
      questions: QuizQuestion[],
      { answered = [], currentIndex = 0, questionSource = 'official' }: {
        answered?: QuizQuestion[];
        currentIndex?: number;
        questionSource?: string;
      } = {}
    ) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 2,
          savedAt: 0,
          state: {
            isActive: true,
            questions: ids(questions),
            currentIndex,
            answers: answered.map(answer),
            startTime: 123,
            config: { ...base, questionSource },
          },
        })
      );
      const { result } = renderHook(() => useQuiz());
      let resumed: boolean | undefined;
      act(() => {
        resumed = result.current.resumeQuiz();
      });
      expect(resumed).toBe(true);
      return result;
    }

    it('只拿掉那一題和它的作答紀錄，其他作答留著', () => {
      const result = resumeFrom([officialA, gist, officialB], { answered: [officialA, gist] });
      expect(ids(result.current.questions)).toEqual([officialA.id, officialB.id]);
      expect(result.current.progress.answered).toBe(1);
      expect(result.current.currentAnswer?.questionId).toBe(officialA.id);
      expect(result.current.config?.questionSource).toBe('official');
    });

    it('拿掉之後存回去，下一次續作不用再拿一次', () => {
      resumeFrom([officialA, gist, officialB], { answered: [officialA, gist] });
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(saved.state.questions).toEqual([officialA.id, officialB.id]);
      expect(ids(saved.state.answers.map((a: { questionId: string }) => ({ id: a.questionId })))).toEqual([
        officialA.id,
      ]);
    });

    it('正在作答的那一題留著：指回那一題，不是原本的位置', () => {
      const result = resumeFrom([officialA, gist, officialB, officialC], { currentIndex: 2 });
      expect(result.current.currentQuestion?.id).toBe(officialB.id);
    });

    // 40 題，第 10、20、30 題失去標記，前 30 題已答，停在第 30 題：下一題是原本的第 31 題，不能跳過未答的題目
    it('拿掉多題，正在作答的那一題也被拿掉：落在它後面第一題', () => {
      const official = getSourceCandidates('all', 'official').slice(0, 37);
      const lost = allQuestions.filter((q) => !q.officialExam && !q.officialSample).slice(0, 3);
      const questions = [...official];
      for (const [i, position] of [9, 19, 29].entries()) questions.splice(position, 0, lost[i]);
      const result = resumeFrom(questions, { answered: questions.slice(0, 30), currentIndex: 29 });
      expect(result.current.questions).toHaveLength(37);
      expect(result.current.progress.answered).toBe(27);
      expect(result.current.currentQuestion?.id).toBe(questions[30].id);
      expect(result.current.currentAnswer).toBeNull();
    });

    it('正在作答的就是被拿掉的那一題：不越界', () => {
      const result = resumeFrom([officialA, gist], { currentIndex: 1 });
      expect(result.current.currentQuestion?.id).toBe(officialA.id);
    });

    it("'all' 不拿題目", () => {
      const result = resumeFrom([officialA, gist], { questionSource: 'all' });
      expect(ids(result.current.questions)).toEqual([officialA.id, gist.id]);
    });

    it('只出某一場：別場的官方題一樣拿掉', () => {
      const [newest, older] = officialSessions(allQuestions).map(
        (session) => allQuestions.find((q) => q.officialExam?.session === session)!
      );
      const result = resumeFrom([older, newest], {
        questionSource: `exam:${newest.officialExam!.session}`,
      });
      expect(ids(result.current.questions)).toEqual([newest.id]);
    });
  });

  // 只出官方題目的保證（每一題都帶官方標記）對續作也成立：回不去的進度安全放棄，不出非官方題
  it('只出官方題目的進度裡有非官方題：不續作，清掉存檔', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        savedAt: 0,
        state: {
          isActive: true,
          questions: ['gist-1', 'gist-2'],
          currentIndex: 0,
          answers: [],
          startTime: 123,
          config: { ...base, questionSource: 'official' },
        },
      })
    );
    const { result } = renderHook(() => useQuiz());
    let resumed: boolean | undefined;
    act(() => {
      resumed = result.current.resumeQuiz();
    });
    expect(resumed).toBe(false);
    expect(result.current.isActive).toBe(false);
    expect(result.current.questions).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
