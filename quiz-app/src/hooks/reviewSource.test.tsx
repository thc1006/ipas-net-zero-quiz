// useQuiz 與星號、待複習錯題：finishQuiz 記錄作答；startReviewQuiz 依名單抽題，題目清單開始時就定下來
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useQuiz } from './useQuiz';
import {
  REVIEW_STORAGE_KEY,
  __resetReviewStoreForTesting,
  getReviewNotice,
  getReviewSnapshot,
  isStarred,
  removeFromReview,
  setStar,
  wrongEntry,
} from '../utils/review-storage';
import { allQuestions, getRandomQuestionsFromPool } from '../data/questions';
import { reviewCandidates } from '../utils/question-source';
import { installRealLocalStorage } from '../utils/__fixtures__/real-local-storage';
import {
  __resetPracticePoolCacheForTesting,
  __setPracticePoolForTesting,
  loadPracticePool,
} from '../utils/practice-pool';
import { buildFixturePool } from '../utils/__fixtures__/practice-pool-fixture';
import { isQuestionScorable } from '../utils/scorable';
import type { QuizConfig, QuizQuestion, ReviewSource } from '../types/quiz';

vi.mock('../utils/practice-pool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/practice-pool')>();
  return { ...actual, loadPracticePool: vi.fn(actual.loadPracticePool) };
});

let store: Map<string, string>;
const scorable = allQuestions.filter((q) => isQuestionScorable(q));
const ids = (n: number) => scorable.slice(0, n).map((q) => q.id);
const wrongAnswerOf = (q: QuizQuestion) => q.options.find((o) => o.key !== q.answer)!.key;

const put = (stars: string[], wrong: Record<string, { streak: number; last: number }> = {}) =>
  store.set(
    REVIEW_STORAGE_KEY,
    JSON.stringify({ v: 1, seeded: true, stars: Object.fromEntries(stars.map((id) => [id, 1])), wrong })
  );

const config = (questionSource: ReviewSource, over: Partial<QuizConfig> = {}): QuizConfig => ({
  mode: 'practice',
  subject: 'all',
  questionCount: 20,
  shuffleQuestions: false,
  showAnswerImmediately: true,
  questionSource,
  ...over,
});

async function drill(c: QuizConfig) {
  const hook = renderHook(() => useQuiz());
  let started: boolean | undefined;
  await act(async () => {
    started = await hook.result.current.startReviewQuiz(c);
  });
  return { ...hook, started };
}

function start(c: Partial<QuizConfig> = {}) {
  const hook = renderHook(() => useQuiz());
  act(() => {
    hook.result.current.startQuiz({
      mode: 'practice',
      subject: 'all',
      questionCount: 3,
      shuffleQuestions: false,
      showAnswerImmediately: true,
      ...c,
    });
  });
  return hook;
}

/** 依序作答：'right' 答對、'wrong' 答錯、null 跳過這一題 */
function answerAll(result: ReturnType<typeof start>['result'], plan: Array<'right' | 'wrong' | null>) {
  plan.forEach((p, i) => {
    const q = result.current.currentQuestion!;
    if (p) {
      act(() => {
        result.current.submitAnswer(p === 'right' ? q.answer : wrongAnswerOf(q));
      });
    }
    if (i < plan.length - 1) {
      act(() => {
        result.current.nextQuestion();
      });
    }
  });
}

beforeEach(() => {
  store = installRealLocalStorage();
  __resetReviewStoreForTesting();
  __resetPracticePoolCacheForTesting();
  vi.mocked(loadPracticePool).mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('finishQuiz 記錄作答', () => {
  it('答錯進待複習；答對不在待複習裡的什麼都不記；沒作答不算錯', () => {
    put([]);
    const { result } = start();
    const [right, wrong, skipped] = result.current.questions;
    answerAll(result, ['right', 'wrong', null]);
    act(() => {
      result.current.finishQuiz();
    });
    const review = getReviewSnapshot();
    expect(wrongEntry(review, wrong.id)).toEqual({ streak: 0, last: expect.any(Number) });
    expect(wrongEntry(review, right.id)).toBeUndefined();
    expect(wrongEntry(review, skipped.id)).toBeUndefined();
  });

  it('一場裡改答：只算最後的答案', () => {
    put([]);
    const { result } = start({ questionCount: 1 });
    const q = result.current.currentQuestion!;
    act(() => {
      result.current.submitAnswer(wrongAnswerOf(q));
    });
    act(() => {
      result.current.submitAnswer(q.answer);
    });
    act(() => {
      result.current.finishQuiz();
    });
    expect(wrongEntry(getReviewSnapshot(), q.id)).toBeUndefined();
  });

  it('連續兩場答對才移出：第一場 streak 變 1，第二場移出；星號不動', () => {
    const [id] = ids(1);
    put([id], { [id]: { streak: 0, last: 1 } });
    for (const expected of [{ streak: 1 }, undefined]) {
      const { result } = start({ questionCount: 1 });
      answerAll(result, ['right']);
      act(() => {
        result.current.finishQuiz();
      });
      const entry = wrongEntry(getReviewSnapshot(), id);
      if (expected) expect(entry).toMatchObject(expected);
      else expect(entry).toBeUndefined();
      cleanup();
    }
    expect(isStarred(getReviewSnapshot(), id)).toBe(true);
  });

  it('放棄的測驗不記錄：softReset、resetQuiz 都一樣，跟作答統計相同', () => {
    put([]);
    for (const abort of ['softReset', 'resetQuiz'] as const) {
      const { result } = start({ questionCount: 1 });
      answerAll(result, ['wrong']);
      act(() => {
        result.current[abort]();
      });
      expect(getReviewSnapshot().wrong).toEqual({});
      cleanup();
    }
  });

  it('寫不進去時測驗照常結束', () => {
    put([]);
    const { result } = start({ questionCount: 1 });
    answerAll(result, ['wrong']);
    localStorage.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    let finished: ReturnType<typeof result.current.finishQuiz> = null;
    act(() => {
      finished = result.current.finishQuiz();
    });
    expect(finished).not.toBeNull();
    expect(getReviewNotice()).toBe('write-failed');
  });

  it('開站時沒帶入成功：這一場結束時一併帶入，答對照算', () => {
    const [id] = ids(1);
    store.set(
      'ipas-question-stats',
      JSON.stringify({ version: 1, items: { [id]: { attempts: 2, correct: 1, lastTriedAt: 5 } } })
    );
    const { result } = start({ questionCount: 1 });
    answerAll(result, ['right']);
    act(() => {
      result.current.finishQuiz();
    });
    expect(wrongEntry(getReviewSnapshot(), id)).toMatchObject({ streak: 1 });
  });
});

describe('手動移出之後結束測驗', () => {
  it('這一場答錯、手動移出：結束時不加回來', () => {
    const [id] = ids(1);
    put([], { [id]: { streak: 0, last: 1 } });
    const { result } = start({ questionCount: 1 });
    answerAll(result, ['wrong']);
    act(() => {
      removeFromReview(id);
    });
    let finished: ReturnType<typeof result.current.finishQuiz> = null;
    act(() => {
      finished = result.current.finishQuiz();
    });
    expect(wrongEntry(getReviewSnapshot(), id)).toBeUndefined();
    expect(finished!.reviewSummary).toEqual({ added: 0, removed: 0 });
  });

  it('重新整理、續作之後也不加回來', () => {
    const [id] = ids(1);
    put([], { [id]: { streak: 0, last: 1 } });
    const first = start({ questionCount: 1 });
    answerAll(first.result, ['wrong']);
    act(() => {
      removeFromReview(id);
    });
    first.unmount();
    __resetReviewStoreForTesting();

    const reloaded = renderHook(() => useQuiz());
    act(() => {
      reloaded.result.current.resumeQuiz();
    });
    act(() => {
      reloaded.result.current.finishQuiz();
    });
    expect(wrongEntry(getReviewSnapshot(), id)).toBeUndefined();
  });
});

describe('同一份進度在兩個分頁都完成', () => {
  it('只記一次：一場不會答對兩次而移出', () => {
    const [id] = ids(1);
    put([], { [id]: { streak: 0, last: 1 } });
    const tabA = start({ questionCount: 1 });
    answerAll(tabA.result, ['right']);
    const tabB = renderHook(() => useQuiz());
    act(() => {
      tabB.result.current.resumeQuiz();
    });
    act(() => {
      tabA.result.current.finishQuiz();
    });
    expect(wrongEntry(getReviewSnapshot(), id)).toMatchObject({ streak: 1 });
    act(() => {
      tabB.result.current.finishQuiz();
    });
    expect(wrongEntry(getReviewSnapshot(), id)).toMatchObject({ streak: 1 });
  });
});

describe('finishQuiz 的摘要', () => {
  it('結果帶著這場的變動', () => {
    const [a, b] = ids(2);
    put([], { [a]: { streak: 1, last: 1 } });
    const { result } = start({ questionCount: 2 });
    answerAll(result, ['right', 'wrong']);
    let finished: ReturnType<typeof result.current.finishQuiz> = null;
    act(() => {
      finished = result.current.finishQuiz();
    });
    expect(finished!.reviewSummary).toEqual({ added: 1, removed: 1 });
    expect(wrongEntry(getReviewSnapshot(), b)).toBeDefined();
  });

  it('寫入失敗是 null：結果頁不說有進待複習', () => {
    put([]);
    const { result } = start({ questionCount: 1 });
    answerAll(result, ['wrong']);
    localStorage.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    let finished: ReturnType<typeof result.current.finishQuiz> = null;
    act(() => {
      finished = result.current.finishQuiz();
    });
    expect(finished!.reviewSummary).toBeNull();
  });
});

describe('startReviewQuiz', () => {
  it('練習池載入中改了名單：用載入完的名單抽題', async () => {
    const pool = buildFixturePool();
    let resolve!: (p: typeof pool) => void;
    vi.mocked(loadPracticePool).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const [a, b] = ids(2);
    put([a, 'pool-only']);
    const { result } = renderHook(() => useQuiz());
    let pending: Promise<boolean> | undefined;
    act(() => {
      pending = result.current.startReviewQuiz(config('review:starred'));
    });
    setStar(a, false);
    setStar(b, true);
    await act(async () => {
      resolve(pool);
      await pending;
    });
    expect(result.current.questions.map((q) => q.id)).toEqual([b]);
  });

  it('只載入需要的名單：選星號題時，待複習錯題裡的練習池題不會觸發載入', async () => {
    const [a] = ids(1);
    put([a], { 'pool-only': { streak: 0, last: 1 } });
    await drill(config('review:starred'));
    expect(loadPracticePool).not.toHaveBeenCalled();
  });

  it('不隨機：照 reviewCandidates 的順序，每一題都在名單上', async () => {
    const stars = ids(5).reverse();
    put(stars);
    const { result, started } = await drill(config('review:starred'));
    expect(started).toBe(true);
    const want = reviewCandidates(allQuestions, 'all', 'review:starred', getReviewSnapshot());
    expect(result.current.questions.map((q) => q.id)).toEqual(want.map((q) => q.id));
    expect(result.current.questions).toHaveLength(5);
  });

  it('隨機：用主題庫同一套洗牌（固定亂數下逐題相同）', async () => {
    put(ids(12));
    const candidates = reviewCandidates(allQuestions, 'all', 'review:starred', getReviewSnapshot());
    let x = 0.31;
    const rng = () => (x = (x * 7.13 + 0.17) % 1);
    vi.spyOn(Math, 'random').mockImplementation(rng);
    const want = getRandomQuestionsFromPool(candidates, 5, 'all', true).map((q) => q.id);
    x = 0.31;
    const { result } = await drill(config('review:starred', { shuffleQuestions: true, questionCount: 5 }));
    expect(result.current.questions.map((q) => q.id)).toEqual(want);
  });

  it('題數上限照設定；比名單少時只出設定的題數', async () => {
    put(ids(5));
    const { result } = await drill(config('review:starred', { questionCount: 2 }));
    expect(result.current.questions).toHaveLength(2);
  });

  it('待複習錯題與兩者', async () => {
    const [a, b, c] = ids(3);
    put([a, b], { [b]: { streak: 0, last: 1 }, [c]: { streak: 0, last: 1 } });
    const wrong = await drill(config('review:wrong'));
    expect(wrong.result.current.questions.map((q) => q.id).sort()).toEqual([b, c].sort());
    const both = await drill(config('review:both'));
    expect(both.result.current.questions.map((q) => q.id).sort()).toEqual([a, b, c].sort());
  });

  it('跟考科組合', async () => {
    const one = scorable.find((q) => q.subject === '考科1')!;
    const two = scorable.find((q) => q.subject === '考科2')!;
    put([one.id, two.id]);
    const { result } = await drill(config('review:starred', { subject: '考科2' }));
    expect(result.current.questions.map((q) => q.id)).toEqual([two.id]);
  });

  it('一題都沒有：回傳 false、不開始', async () => {
    put([]);
    const { result, started } = await drill(config('review:starred'));
    expect(started).toBe(false);
    expect(result.current.isActive).toBe(false);
  });

  it('名單都在主題庫：不載入練習池', async () => {
    put(ids(2));
    await drill(config('review:starred'));
    expect(loadPracticePool).not.toHaveBeenCalled();
  });

  it('名單上有練習池題：就算加強練習沒開也載入', async () => {
    const pool = buildFixturePool();
    __setPracticePoolForTesting(pool);
    const poolId = pool.items[0].id;
    put([ids(1)[0], poolId]);
    const { result } = await drill(config('review:starred'));
    expect(loadPracticePool).toHaveBeenCalled();
    expect(result.current.questions.map((q) => q.id)).toContain(poolId);
    expect(result.current.questions.find((q) => q.id === poolId)?.sourceType).toBe('practice_pool');
  });

  it('練習池載入失敗：用主題庫出題，並告知使用者', async () => {
    vi.mocked(loadPracticePool).mockRejectedValueOnce(new Error('offline'));
    const [id] = ids(1);
    put([id, 'pool-only']);
    const { result, started } = await drill(config('review:starred'));
    expect(started).toBe(true);
    expect(result.current.questions.map((q) => q.id)).toEqual([id]);
    expect(getReviewNotice()).toBe('pool-failed');
  });

  it('練習池載入失敗又沒有主題庫題：不開始，同樣告知', async () => {
    vi.mocked(loadPracticePool).mockRejectedValueOnce(new Error('offline'));
    put(['pool-only']);
    const { started } = await drill(config('review:starred'));
    expect(started).toBe(false);
    expect(getReviewNotice()).toBe('pool-failed');
  });

  it('連按兩次開始：只有最後一次算數，前一次晚到也不換掉', async () => {
    const pool = buildFixturePool();
    __setPracticePoolForTesting(pool);
    let resolveFirst!: (p: typeof pool) => void;
    vi.mocked(loadPracticePool).mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));
    put([...ids(2), 'pool-only']);
    const { result } = renderHook(() => useQuiz());
    let first: Promise<boolean> = Promise.resolve(true);
    let second: Promise<boolean> = Promise.resolve(false);
    act(() => {
      first = result.current.startReviewQuiz(config('review:starred'));
      second = result.current.startReviewQuiz(config('review:starred', { questionCount: 1 }));
    });
    await act(async () => {
      expect(await second).toBe(true);
      resolveFirst(pool);
      expect(await first).toBe(false);
    });
    expect(result.current.questions).toHaveLength(1);
  });

  it('startQuiz 與 startQuizWithPool 不處理這些來源：不抽題、回傳 false，不會悄悄變成官方題目路徑', async () => {
    put(ids(2));
    const { result } = renderHook(() => useQuiz());
    let sync: boolean | undefined;
    act(() => {
      sync = result.current.startQuiz(config('review:starred'));
    });
    expect(sync).toBe(false);
    let viaPool: boolean | undefined;
    await act(async () => {
      viaPool = await result.current.startQuizWithPool(config('review:starred'));
    });
    expect(viaPool).toBe(false);
  });
});

describe('清單在開始時定下來', () => {
  it('中途取消星號：不跳題、不重排，取消的那一題照樣計分', async () => {
    const stars = ids(4);
    put(stars);
    const { result } = await drill(config('review:starred'));
    const before = result.current.questions.map((q) => q.id);
    const middle = before[1];
    act(() => {
      result.current.nextQuestion();
    });
    act(() => {
      setStar(middle, false);
    });
    expect(result.current.questions.map((q) => q.id)).toEqual(before);
    expect(result.current.currentQuestion?.id).toBe(middle);
    act(() => {
      result.current.submitAnswer(result.current.currentQuestion!.answer);
    });
    let finished: ReturnType<typeof result.current.finishQuiz> = null;
    act(() => {
      finished = result.current.finishQuiz();
    });
    expect(finished!.correctCount).toBe(1);
  });

  it('開始一場、取消星號、重新載入、續作：不被當成壞進度丟掉', async () => {
    const stars = ids(3);
    put(stars);
    const first = await drill(config('review:starred'));
    const before = first.result.current.questions.map((q) => q.id);
    act(() => {
      first.result.current.submitAnswer(first.result.current.currentQuestion!.answer);
    });
    act(() => {
      first.result.current.nextQuestion();
    });
    act(() => {
      setStar(before[0], false);
      setStar(before[1], false);
      setStar(before[2], false);
    });
    first.unmount();

    const reloaded = renderHook(() => useQuiz());
    let resumed: boolean | undefined;
    act(() => {
      resumed = reloaded.result.current.resumeQuiz();
    });
    expect(resumed).toBe(true);
    expect(reloaded.result.current.questions.map((q) => q.id)).toEqual(before);
    expect(reloaded.result.current.currentIndex).toBe(1);
    expect(reloaded.result.current.config?.questionSource).toBe('review:starred');
  });

  it('練習池題的一場也續作得回來', async () => {
    const pool = buildFixturePool();
    __setPracticePoolForTesting(pool);
    put([pool.items[0].id]);
    const first = await drill(config('review:starred'));
    expect(first.result.current.questions).toHaveLength(1);
    first.unmount();
    const reloaded = renderHook(() => useQuiz());
    act(() => {
      reloaded.result.current.resumeQuiz();
    });
    expect(reloaded.result.current.questions.map((q) => q.id)).toEqual([pool.items[0].id]);
  });
});
