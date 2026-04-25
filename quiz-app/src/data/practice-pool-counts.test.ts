// 驗證 PRACTICE_POOL_COUNTS / POOL_BY_SUBJECT 跟 practice_pool.json 一致
// 防止常數漂移 — 任何一邊改了，CI 會擋下
import { describe, it, expect } from 'vitest';
import { PRACTICE_POOL_COUNTS, POOL_BY_SUBJECT } from './practice-pool-counts';
import practicePool from './practice_pool.json';

interface PoolMeta {
  totals: {
    external_mock: number;
    ai_generated: number;
    total: number;
  };
}

interface PoolItem {
  subject?: string;
  provenance: { source_type: 'external_mock' | 'ai_generated' };
  quality_flags?: string[];
}

interface Pool {
  _meta: PoolMeta;
  items: PoolItem[];
}

const pool = practicePool as Pool;

describe('PRACTICE_POOL_COUNTS', () => {
  it('matches practice_pool.json _meta.totals', () => {
    expect(PRACTICE_POOL_COUNTS.externalMock).toBe(pool._meta.totals.external_mock);
    expect(PRACTICE_POOL_COUNTS.aiGenerated).toBe(pool._meta.totals.ai_generated);
    expect(PRACTICE_POOL_COUNTS.total).toBe(pool._meta.totals.total);
  });

  it('total equals externalMock + aiGenerated', () => {
    expect(PRACTICE_POOL_COUNTS.total).toBe(
      PRACTICE_POOL_COUNTS.externalMock + PRACTICE_POOL_COUNTS.aiGenerated,
    );
  });
});

describe('POOL_BY_SUBJECT', () => {
  // 計算實際 pool 內每個 subject 的可抽題數
  // 規則：subject filter '考科1' 排除 unmapped_subject flag 題目；'all' 包含
  function actualBreakdown(filter: 'all' | '考科一' | '考科二'): {
    externalMock: number;
    aiGenerated: number;
  } {
    const filtered = pool.items.filter((q) => {
      const flags = q.quality_flags ?? [];
      const hasUnmapped = flags.includes('unmapped_subject');
      if (filter === 'all') return true;
      if (hasUnmapped) return false;
      return q.subject?.startsWith(filter);
    });
    return {
      externalMock: filtered.filter((q) => q.provenance.source_type === 'external_mock').length,
      aiGenerated: filtered.filter((q) => q.provenance.source_type === 'ai_generated').length,
    };
  }

  it('all matches PRACTICE_POOL_COUNTS', () => {
    expect(POOL_BY_SUBJECT.all.total).toBe(PRACTICE_POOL_COUNTS.total);
    expect(POOL_BY_SUBJECT.all.externalMock).toBe(PRACTICE_POOL_COUNTS.externalMock);
    expect(POOL_BY_SUBJECT.all.aiGenerated).toBe(PRACTICE_POOL_COUNTS.aiGenerated);
  });

  it('考科1 matches actual filtered pool', () => {
    const actual = actualBreakdown('考科一');
    expect(POOL_BY_SUBJECT['考科1'].externalMock).toBe(actual.externalMock);
    expect(POOL_BY_SUBJECT['考科1'].aiGenerated).toBe(actual.aiGenerated);
  });

  it('考科2 matches actual filtered pool', () => {
    const actual = actualBreakdown('考科二');
    expect(POOL_BY_SUBJECT['考科2'].externalMock).toBe(actual.externalMock);
    expect(POOL_BY_SUBJECT['考科2'].aiGenerated).toBe(actual.aiGenerated);
  });

  it('each entry total = externalMock + aiGenerated', () => {
    for (const [, entry] of Object.entries(POOL_BY_SUBJECT)) {
      expect(entry.total).toBe(entry.externalMock + entry.aiGenerated);
    }
  });
});
