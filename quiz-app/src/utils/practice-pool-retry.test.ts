// 練習池 chunk 載不到之後網路恢復，不重新整理也要載得到：另開一檔，因為要 mock 掉整份 practice_pool.json
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetPracticePoolCacheForTesting, loadPracticePool } from './practice-pool';

const chunk = vi.hoisted(() => ({ broken: true }));
vi.mock('../data/practice_pool.json', () => ({
  get default() {
    if (chunk.broken) throw new TypeError('Failed to fetch dynamically imported module');
    return { items: [] };
  },
}));

describe('loadPracticePool 載入失敗', () => {
  beforeEach(() => __resetPracticePoolCacheForTesting());

  it('失敗不留在快取：下一次呼叫重新載入', async () => {
    await expect(loadPracticePool()).rejects.toThrow('Failed to fetch');

    chunk.broken = false;

    await expect(loadPracticePool()).resolves.toEqual({ items: [] });
  });
});
