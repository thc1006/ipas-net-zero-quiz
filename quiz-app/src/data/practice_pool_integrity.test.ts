// Practice pool 資料完整性測試
//
// 對 ai_generated 題目強制要求：
// 1. 必有 answer（非空字串）
// 2. 必有 explanation
// 3. 必有 ≥1 條 sources URL（http/https，不能是空陣列）
//    — 對應 memory: every answer change requires a primary-source URL
// 4. answer 必須在 options 的 key 集合中（防止 answer 跟 options 不一致）
//
// 失敗時列出違規 id，方便定位修復目標。
import { describe, it, expect } from 'vitest';
import practicePool from './practice_pool.json';

interface PoolItem {
  id: string;
  stem: string;
  options: { key: string; text: string }[];
  answer: string;
  explanation: string;
  provenance: { source_type: string };
  sources: string[];
}

interface Pool {
  _meta: unknown;
  items: PoolItem[];
}

const pool = practicePool as Pool;

describe('practice_pool.json — ai_generated integrity', () => {
  const aiItems = pool.items.filter(
    (q) => q.provenance.source_type === 'ai_generated'
  );

  it('每題都有非空 answer', () => {
    const offenders = aiItems
      .filter((q) => !q.answer || q.answer.trim() === '')
      .map((q) => q.id);
    expect(offenders, `空 answer：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('每題都有非空 explanation', () => {
    const offenders = aiItems
      .filter((q) => !q.explanation || q.explanation.trim() === '')
      .map((q) => q.id);
    expect(offenders, `空 explanation：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('每題都有 ≥1 條 primary-source URL（http/https）', () => {
    const offenders = aiItems
      .filter((q) => {
        if (!Array.isArray(q.sources) || q.sources.length === 0) return true;
        // 任何一條 source 至少要是 http(s) URL
        return !q.sources.some(
          (s) => typeof s === 'string' && /^https?:\/\//.test(s)
        );
      })
      .map((q) => q.id);
    expect(
      offenders,
      `缺 primary-source URL（違反 citation policy）：\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('answer 必須在 options 的 key 集合中', () => {
    const offenders = aiItems
      .filter((q) => {
        const keys = new Set(q.options.map((o) => o.key));
        return !keys.has(q.answer);
      })
      .map((q) => `${q.id} (answer=${q.answer})`);
    expect(
      offenders,
      `answer 不在 options keys：\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});
