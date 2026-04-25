// 驗證 PRACTICE_POOL_COUNTS 跟 practice_pool.json _meta.totals 一致
// 防止常數漂移 — 任何一邊改了，CI 會擋下
import { describe, it, expect } from 'vitest';
import { PRACTICE_POOL_COUNTS } from './practice-pool-counts';
import practicePool from './practice_pool.json';

interface PoolMeta {
  totals: {
    external_mock: number;
    ai_generated: number;
    total: number;
  };
}

describe('PRACTICE_POOL_COUNTS', () => {
  it('matches practice_pool.json _meta.totals', () => {
    const meta = (practicePool as { _meta: PoolMeta })._meta;
    expect(PRACTICE_POOL_COUNTS.externalMock).toBe(meta.totals.external_mock);
    expect(PRACTICE_POOL_COUNTS.aiGenerated).toBe(meta.totals.ai_generated);
    expect(PRACTICE_POOL_COUNTS.total).toBe(meta.totals.total);
  });

  it('total equals externalMock + aiGenerated', () => {
    expect(PRACTICE_POOL_COUNTS.total).toBe(
      PRACTICE_POOL_COUNTS.externalMock + PRACTICE_POOL_COUNTS.aiGenerated,
    );
  });
});
