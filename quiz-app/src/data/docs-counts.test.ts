// 文件裡的題數不得與資料漂移。
//
// 起因：資料已經是 783 題（799 → 782 去重 → 783 拆題），但 README 頂部仍寫「799 題主題庫」，
// CONTENT-CURRENCY.md 仍寫「119 題 time_sensitive」（實際 115）。
// 這種漂移不是打錯字 —— 它會讓讀者對題庫規模與查證範圍產生錯誤認知，
// 而且每次改資料都要記得手動同步 N 個地方，遲早會忘。
//
// 所以把「文件宣稱的數字」和「資料的真實數字」綁在一起測。
// 改了資料卻沒改文件（或反過來），CI 當場擋下。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import datasetRaw from './integrated_dataset.json';
import poolRaw from './practice_pool.json';

interface Item {
  quality_flags?: string[];
  metadata?: { valid_as_of?: string };
}
const DS = datasetRaw as unknown as {
  meta: { total_questions: number; content_review: { reverified_count: number; last_review_date: string } };
  gist_items: Item[];
  our_unique_items: Item[];
};
const POOL = poolRaw as unknown as { items: unknown[] };

const ALL = [...DS.gist_items, ...DS.our_unique_items];
const TOTAL = DS.meta.total_questions;
const TIME_SENSITIVE = ALL.filter((i) => (i.quality_flags ?? []).includes('time_sensitive')).length;
const POOL_TOTAL = POOL.items.length;
const REVERIFIED = DS.meta.content_review.reverified_count;

// repo root = quiz-app/src/data -> ../../..
const root = resolve(__dirname, '..', '..', '..');
const read = (f: string) => readFileSync(resolve(root, f), 'utf8');
const README = read('README.md');
const CURRENCY = read('CONTENT-CURRENCY.md');

describe('文件的題數必須與資料一致', () => {
  it('README「N 題主題庫」必須等於 meta.total_questions', () => {
    const m = README.match(/\*\*(\d+)\s*題主題庫\*\*/);
    expect(m, 'README 找不到「**N 題主題庫**」').not.toBeNull();
    expect(Number(m![1])).toBe(TOTAL);
  });

  it('README「N 題補充題」必須等於練習池題數', () => {
    const m = README.match(/額外提供\s*(\d+)\s*題補充題/);
    expect(m, 'README 找不到「額外提供 N 題補充題」').not.toBeNull();
    expect(Number(m![1])).toBe(POOL_TOTAL);
  });

  it('README「N 題的答案會隨法規變動」必須等於 time_sensitive 題數', () => {
    const m = README.match(/題庫中有\s*(\d+)\s*題的答案會隨法規變動/);
    expect(m, 'README 找不到「題庫中有 N 題的答案會隨法規變動」').not.toBeNull();
    expect(Number(m![1])).toBe(TIME_SENSITIVE);
  });

  it('README「本輪只實查 X/Y 題」必須等於 reverified_count / total', () => {
    const m = README.match(/本輪只實查\s*(\d+)\s*\/\s*(\d+)\s*題/);
    expect(m, 'README 找不到「本輪只實查 X/Y 題」').not.toBeNull();
    expect(Number(m![1])).toBe(REVERIFIED);
    expect(Number(m![2])).toBe(TOTAL);
  });

  it('CONTENT-CURRENCY「本輪只實查了 X / Y 題」必須與資料一致', () => {
    const m = CURRENCY.match(/本輪只實查了\s*\*\*(\d+)\s*\/\s*(\d+)\*\*\s*題/);
    expect(m, 'CONTENT-CURRENCY 找不到「本輪只實查了 **X / Y** 題」').not.toBeNull();
    expect(Number(m![1])).toBe(REVERIFIED);
    expect(Number(m![2])).toBe(TOTAL);
  });

  it('CONTENT-CURRENCY「N 題標記 time_sensitive」必須與資料一致', () => {
    const m = CURRENCY.match(/\*\*(\d+)\s*題\*\*標記\s*`time_sensitive`/);
    expect(m, 'CONTENT-CURRENCY 找不到「**N 題**標記 `time_sensitive`」').not.toBeNull();
    expect(Number(m![1])).toBe(TIME_SENSITIVE);
  });

  // 這些數字是「宣稱」，必須有資料支撐；抓不到就代表文件被改壞了或格式漂了
  it('README 不得再出現已作廢的題數（799 / 782 / 647 / 648）', () => {
    const stale = ['799 題主題庫', '782 題主題庫', '647 題主題庫', '648 題主題庫'].filter((s) =>
      README.includes(s)
    );
    expect(stale).toEqual([]);
  });
});
