// 改過兩次 id 的題目（renamed_from.previous）：兩個舊 id 都還存在使用者的瀏覽器裡，而且一樣新。
// 題庫裡還沒有改過兩次的題目，所以 mock 一條：C 原本是 B，B 原本是 A。
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../data/renamed-questions', async (importOriginal) => {
  const real = await importOriginal<typeof import('../data/renamed-questions')>();
  const map = real.currentIdsByOldId([['C', { item_id: 'B', previous: { item_id: 'A' } }]]);
  return { ...real, currentQuestionId: (id: string) => map.get(id) ?? id };
});

import {
  REVIEW_STORAGE_KEY,
  __resetReviewStoreForTesting,
  getReviewSnapshot,
  isStarred,
  wrongEntry,
} from './review-storage';
import { parseReviewImport } from './review-transfer';
import { installRealLocalStorage } from './__fixtures__/real-local-storage';
import type { ReviewStars, ReviewWrong } from './review-storage';

let store: Map<string, string>;
beforeAll(() => {
  store = installRealLocalStorage();
});
beforeEach(() => {
  store.clear();
  __resetReviewStoreForTesting();
});

const read = (stars: ReviewStars, wrong: ReviewWrong) => {
  store.set(REVIEW_STORAGE_KEY, JSON.stringify({ v: 1, seeded: true, stars, wrong }));
  __resetReviewStoreForTesting();
  return getReviewSnapshot();
};

const imported = (stars: ReviewStars, wrong: ReviewWrong) => {
  const r = parseReviewImport(
    JSON.stringify({ app: 'ipas-net-zero-quiz', schema: 1, exportedAt: '2026-11-01T00:00:00.000Z', stars, wrong })
  );
  if (!r.ok) throw new Error(r.reason);
  return r;
};

// 同一組紀錄的每一種存放順序
function orders<T>(items: Record<string, T>): Record<string, T>[] {
  const entries = Object.entries(items);
  const out: Record<string, T>[] = [];
  const permute = (rest: typeof entries, acc: typeof entries) => {
    if (rest.length === 0) out.push(Object.fromEntries(acc));
    rest.forEach((e, i) => permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, e]));
  };
  permute(entries, []);
  return out;
}

describe('同一題的幾筆待複習紀錄一樣新：留連續答對次數少的，與存的順序無關', () => {
  const cases: { name: string; wrong: ReviewWrong; expected: { streak: number; last: number } }[] = [
    {
      name: '兩個舊 id，沒有現在的 id',
      wrong: { A: { streak: 1, last: 5 }, B: { streak: 0, last: 5 } },
      expected: { streak: 0, last: 5 },
    },
    {
      name: '現在的 id 與舊 id',
      wrong: { C: { streak: 1, last: 5 }, A: { streak: 0, last: 5 } },
      expected: { streak: 0, last: 5 },
    },
    {
      name: '三代都在，最新的一筆只有一筆',
      wrong: { A: { streak: 0, last: 5 }, B: { streak: 1, last: 6 }, C: { streak: 0, last: 4 } },
      expected: { streak: 1, last: 6 },
    },
  ];

  for (const { name, wrong, expected } of cases) {
    it(`${name}：讀 localStorage 與匯入備份都一樣`, () => {
      for (const order of orders(wrong)) {
        const where = JSON.stringify(order);
        expect(wrongEntry(read({}, order), 'C'), `讀取 ${where}`).toEqual(expected);
        expect({ ...imported({}, order).wrong }, `匯入 ${where}`).toEqual({ C: expected });
      }
    });
  }
});

describe('星號只有時間：留最新的，與存的順序無關', () => {
  it('讀取與匯入', () => {
    for (const order of orders({ A: 3, B: 9, C: 1 })) {
      const review = read(order, {});
      expect({ ...review.stars }, JSON.stringify(order)).toEqual({ C: 9 });
      expect(isStarred(review, 'A')).toBe(false);
      expect({ ...imported(order, {}).stars }, JSON.stringify(order)).toEqual({ C: 9 });
    }
  });
});
