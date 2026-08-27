// 標準改版偵測不到，只能靠標記。
//
// 季排程只 curl source URL 看是否 200 —— 它偵測不到「ISO 把標準改版了」。
// ISO/FDIS 14068 已進入 approval 階段並將取代 ISO 14068-1:2023；新版發布時，
// 這些題涉及的要求、條號與用語都要重新確認。至少要確保它們全部在季排程的視野內。
import { describe, it, expect } from 'vitest';
import dataset from './integrated_dataset.json';
import pool from './practice_pool.json';

interface Item {
  index?: number;
  item_id?: string;
  id?: string;
  stem: string;
  options: { text: string }[];
  explanation?: string | null;
  quality_flags?: string[];
}

const ds = dataset as unknown as { gist_items: Item[]; our_unique_items: Item[] };
const pp = pool as unknown as { items: Item[] };
const ALL: Item[] = [...ds.gist_items, ...ds.our_unique_items, ...pp.items];
const who = (it: Item) => it.item_id ?? it.id ?? `gist-${it.index}`;

const text = (it: Item) =>
  [it.stem, ...it.options.map((o) => o.text), it.explanation ?? ''].join(' ');

/** 已知有改版在途、必須進入季排程視野的標準 */
const PENDING_REPLACEMENT = [
  { name: 'ISO 14068', pattern: /14068/, note: 'ISO/FDIS 14068 將取代 ISO 14068-1:2023' },
];

describe('改版在途的標準，相關題目必須標 time_sensitive', () => {
  for (const std of PENDING_REPLACEMENT) {
    const affected = ALL.filter((it) => std.pattern.test(text(it)));

    it(`${std.name}：確實有相關題目（gate 不能空轉）`, () => {
      expect(affected.length).toBeGreaterThan(5);
    });

    it(`${std.name}：每一題都在季排程視野內（${std.note}）`, () => {
      const unflagged = affected
        .filter((it) => !(it.quality_flags ?? []).includes('time_sensitive'))
        .map(who);
      expect(
        unflagged,
        `這些題目涉及改版在途的標準，卻沒標 time_sensitive —— 新版發布時不會有人回來看它們`
      ).toEqual([]);
    });
  }
});
