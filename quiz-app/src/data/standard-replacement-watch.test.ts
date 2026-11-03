// 標準改版偵測不到，只能靠標記。
//
// 季排程只 curl source URL 看是否 200，偵測不到「ISO 把標準改版了」。
// ISO 14068:2026 已於 2026-09-11 發布、取代 ISO 14068-1:2023（ISO 官方頁註明只改標題與編號），
// 2026-11-04 逐題重驗過（docs/CONTENT-CURRENCY.md）。下一次改版還是要回來看這些題，
// 所以它們必須留在季排程的視野內；題目上的改版備註也不能還寫著「將取代」。
import { describe, it, expect } from 'vitest';
import dataset from './integrated_dataset.json';
import pool from './practice_pool.json';

interface Evidence {
  url?: string;
  quote?: string;
}

interface Item {
  index?: number;
  item_id?: string;
  id?: string;
  stem: string;
  options: { text: string }[];
  explanation?: string | null;
  quality_flags?: string[];
  metadata?: { evidence?: Evidence[]; standard_replacement_watch?: string };
  provenance?: { evidence?: Evidence[] };
  _standard_replacement_watch?: string;
}

const ds = dataset as unknown as { gist_items: Item[]; our_unique_items: Item[] };
const pp = pool as unknown as { items: Item[] };
const ALL: Item[] = [...ds.gist_items, ...ds.our_unique_items, ...pp.items];
const who = (it: Item) => it.item_id ?? it.id ?? `gist-${it.index}`;

const text = (it: Item) =>
  [it.stem, ...it.options.map((o) => o.text), it.explanation ?? ''].join(' ');
// 主題庫在 metadata.evidence，練習池在 provenance.evidence：兩處都要讀
const evidenceOf = (it: Item): Evidence[] => [
  ...(it.metadata?.evidence ?? []),
  ...(it.provenance?.evidence ?? []),
];
const watchNotes = (it: Item): string[] =>
  [it.metadata?.standard_replacement_watch, it._standard_replacement_watch].filter(
    (n): n is string => typeof n === 'string'
  );

/** 改過版、或改版在途的標準。published 有值＝新版已發布 */
const WATCHED = [
  {
    name: 'ISO 14068',
    pattern: /14068/,
    // ISO 目錄裡這個標準的頁面：舊版 43279、新版 94470（現在轉到 /standard/14068）。
    // gist[61] 的題幹與解析沒寫 14068，答案卻靠 ISO 14068-1 的適用範圍；只看題目文字，2026-08-27 的清單就漏了它
    evidenceUrl: /iso\.org\/standard\/(?:43279|94470|14068)(?![0-9])/,
    published: 'ISO 14068:2026',
    note: 'ISO 14068:2026 已於 2026-09-11 取代 ISO 14068-1:2023',
  },
];

describe('改過版的標準，相關題目必須標 time_sensitive，改版備註要跟上', () => {
  for (const std of WATCHED) {
    const affected = ALL.filter(
      (it) =>
        std.pattern.test(text(it)) ||
        evidenceOf(it).some(
          (e) => std.evidenceUrl.test(e.url ?? '') || std.pattern.test(e.quote ?? '')
        )
    );

    it(`${std.name}：確實有相關題目（gate 不能空轉）`, () => {
      expect(affected.length).toBeGreaterThan(5);
    });

    it(`${std.name}：每一題都在季排程視野內（${std.note}）`, () => {
      const unflagged = affected
        .filter((it) => !(it.quality_flags ?? []).includes('time_sensitive'))
        .map(who);
      expect(
        unflagged,
        `這些題目涉及改過版的標準，卻沒標 time_sensitive：下次改版不會有人回來看它們`
      ).toEqual([]);
    });

    it(`${std.name}：題目上的改版備註寫的是已發布的 ${std.published}，不是「將取代」`, () => {
      const noted = ALL.filter((it) => watchNotes(it).some((n) => std.pattern.test(n)));
      expect(noted.length, '找不到任何改版備註，這條在空轉').toBeGreaterThan(2);
      const stale = noted
        .filter((it) =>
          watchNotes(it).some(
            (n) =>
              std.pattern.test(n) &&
              (!n.includes(std.published) || /FDIS|將取代|approval|仍是/.test(n))
          )
        )
        .map(who);
      expect(stale, `新版已發布，這些題目的改版備註還停在發布前`).toEqual([]);
    });
  }
});
