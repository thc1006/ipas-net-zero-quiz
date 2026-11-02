// useReviewQuestions：題目來源選單上的題數。名單上可能有練習池題，練習池是懶載入的，題數要等它載完才算數
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useReviewQuestions } from './useReviewQuestions';
import { REVIEW_STORAGE_KEY, __resetReviewStoreForTesting, setStar } from '../utils/review-storage';
import { allQuestions, dedupeByContent } from '../data/questions';
import { installRealLocalStorage } from '../utils/__fixtures__/real-local-storage';
import {
  __resetPracticePoolCacheForTesting,
  __setPracticePoolForTesting,
  loadPracticePool,
} from '../utils/practice-pool';
import { buildFixturePool } from '../utils/__fixtures__/practice-pool-fixture';
import { isQuestionScorable } from '../utils/scorable';

vi.mock('../utils/practice-pool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/practice-pool')>();
  return { ...actual, loadPracticePool: vi.fn(actual.loadPracticePool) };
});

let store: Map<string, string>;
const put = (stars: string[], wrong: string[] = []) =>
  store.set(
    REVIEW_STORAGE_KEY,
    JSON.stringify({
      v: 1,
      seeded: true,
      stars: Object.fromEntries(stars.map((id) => [id, 1])),
      wrong: Object.fromEntries(wrong.map((id) => [id, { streak: 0, last: 1 }])),
    })
  );

const scorable = allQuestions.filter((q) => isQuestionScorable(q));
const s1 = scorable.filter((q) => q.subject === '考科1');
const s2 = scorable.filter((q) => q.subject === '考科2');

beforeEach(() => {
  store = installRealLocalStorage();
  __resetReviewStoreForTesting();
  __resetPracticePoolCacheForTesting();
  vi.mocked(loadPracticePool).mockClear();
});

afterEach(() => {
  cleanup();
});

describe('useReviewQuestions', () => {
  it('名單都在主題庫裡：不載入練習池，題數立刻算好', () => {
    put([s1[0].id, s1[1].id], [s1[1].id, s2[0].id]);
    const { result } = renderHook(() => useReviewQuestions('all'));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.counts).toEqual({ 'review:starred': 2, 'review:wrong': 2, 'review:both': 3 });
    expect(loadPracticePool).not.toHaveBeenCalled();
  });

  it('跟考科組合；totals 不看考科', () => {
    put([s1[0].id, s2[0].id]);
    const { result } = renderHook(() => useReviewQuestions('考科1'));
    expect(result.current.counts['review:starred']).toBe(1);
    expect(result.current.totals['review:starred']).toBe(2);
  });

  it('加星號之後題數馬上更新', () => {
    const { result } = renderHook(() => useReviewQuestions('all'));
    expect(result.current.counts['review:starred']).toBe(0);
    act(() => {
      setStar(s1[0].id, true);
    });
    expect(result.current.counts['review:starred']).toBe(1);
  });

  it('名單上有主題庫沒有的 id：載入練習池，載完才算題數', async () => {
    const fixture = buildFixturePool();
    let resolve!: (p: typeof fixture) => void;
    vi.mocked(loadPracticePool).mockImplementationOnce(
      () => new Promise((r) => { resolve = r; })
    );
    put([s1[0].id, fixture.items[0].id]);
    const { result } = renderHook(() => useReviewQuestions('all'));
    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      resolve(fixture);
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.counts['review:starred']).toBe(2);
    expect(result.current.poolFailed).toBe(false);
  });

  it('只有待複習錯題裡有練習池題：一樣要載入', async () => {
    const fixture = buildFixturePool();
    __setPracticePoolForTesting(fixture);
    vi.mocked(loadPracticePool).mockClear();
    __resetPracticePoolCacheForTesting();
    vi.mocked(loadPracticePool).mockResolvedValueOnce(fixture);
    put([], [fixture.items[0].id]);
    const { result } = renderHook(() => useReviewQuestions('all'));
    await waitFor(() => expect(result.current.counts['review:wrong']).toBe(1));
    expect(loadPracticePool).toHaveBeenCalled();
  });

  it('練習池已經在快取裡：不用再等', () => {
    const fixture = buildFixturePool();
    __setPracticePoolForTesting(fixture);
    put([fixture.items[0].id]);
    const { result } = renderHook(() => useReviewQuestions('all'));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.counts['review:starred']).toBe(1);
  });

  it('認不得的 id 不算題數，名單不動', async () => {
    __setPracticePoolForTesting(buildFixturePool());
    put(['removed-from-bank']);
    const before = store.get(REVIEW_STORAGE_KEY);
    const { result } = renderHook(() => useReviewQuestions('all'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.counts['review:starred']).toBe(0);
    expect(store.get(REVIEW_STORAGE_KEY)).toBe(before);
  });

  it('練習池載入失敗：用主題庫算，並回報', async () => {
    vi.mocked(loadPracticePool).mockRejectedValueOnce(new Error('offline'));
    put([s1[0].id, 'pool-only']);
    const { result } = renderHook(() => useReviewQuestions('all'));
    await waitFor(() => expect(result.current.poolFailed).toBe(true));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.counts['review:starred']).toBe(1);
  });

  it('題數依內容去重：全部主題庫題都加星號時，跨科重複的題目只算一次', () => {
    put(allQuestions.map((q) => q.id));
    const { result } = renderHook(() => useReviewQuestions('all'));
    const deduped = dedupeByContent(scorable).length;
    expect(deduped).toBeLessThan(scorable.length);
    expect(result.current.counts['review:starred']).toBe(deduped);
  });

  it('名單上的練習池題拿掉之後，不再回報載入失敗', async () => {
    vi.mocked(loadPracticePool).mockRejectedValueOnce(new Error('offline'));
    put(['pool-only']);
    const { result } = renderHook(() => useReviewQuestions('all'));
    await waitFor(() => expect(result.current.poolFailed).toBe(true));
    act(() => {
      setStar('pool-only', false);
    });
    expect(result.current.poolFailed).toBe(false);
  });
});
