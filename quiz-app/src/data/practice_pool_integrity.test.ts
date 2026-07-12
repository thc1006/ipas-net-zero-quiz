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
  // 可為 null：標記 'ambiguous' 的題目刻意不給答案，以排除計分。
  answer: string | null;
  explanation: string;
  provenance: { source_type: string };
  sources: string[];
  quality_flags?: string[];
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

  // 例外：明確標記 'ambiguous' 的題目「必須」沒有答案。
  // 題庫不能對互斥的命題同時給出確定答案 —— 與其在文件裡註記「此題有瑕疵」卻照常計分，
  // 不如把答案拿掉（answer=null → hasAnswer=false → 不進考試模式、不計分）。
  it('每題都有非空 answer（除非明確標記 ambiguous）', () => {
    const offenders = aiItems
      .filter((q) => !(q.quality_flags ?? []).includes('ambiguous'))
      .filter((q) => !q.answer || q.answer.trim() === '')
      .map((q) => q.id);
    expect(offenders, `空 answer：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('標記 ambiguous 的題目必須沒有答案（否則等於照常計分）', () => {
    const offenders = pool.items
      .filter((q) => (q.quality_flags ?? []).includes('ambiguous'))
      .filter((q) => q.answer !== null && q.answer !== undefined)
      .map((q) => q.id);
    expect(offenders, `標了 ambiguous 卻仍有答案：\n${offenders.join('\n')}`).toEqual([]);
  });

  // PAS 2060 的撤回日期在現有來源中互相矛盾（BSI 停售驗證 2024-01-01、改用 ISO 14068-1
  // 2025-01-01、標準文件撤回 2025-11-30 —— 是三件不同的事，常被混為一談）。
  // 在取得 BSI 對 PAS 2060:2014 的官方 withdrawal record 之前，任何斷言撤回年份的題目
  // 都不得有確定答案。定案後再把這條測試改成鎖定正確年份。
  it('PAS 2060 撤回年份未定案前，不得有題目對它給出確定答案', () => {
    const offenders = pool.items
      .filter((q) => {
        const blob = q.stem + (q.options ?? []).map((o) => o.text).join();
        return /PAS\s?2060/.test(blob) && /20(24|25)\s*年?/.test(blob);
      })
      .filter((q) => q.answer !== null && q.answer !== undefined)
      .map((q) => q.id);
    expect(
      offenders,
      `PAS 2060 撤回年份仍有確定答案（來源互相矛盾，應標 ambiguous 並排除計分）：\n${offenders.join('\n')}`
    ).toEqual([]);
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

  it('answer 必須在 options 的 key 集合中（answer=null 者除外）', () => {
    const offenders = aiItems
      .filter((q) => q.answer !== null && q.answer !== undefined) // ambiguous 題刻意無答案
      .filter((q) => {
        const keys = new Set(q.options.map((o) => o.key));
        return !keys.has(q.answer as string);
      })
      .map((q) => `${q.id} (answer=${q.answer})`);
    expect(
      offenders,
      `answer 不在 options keys：\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});
