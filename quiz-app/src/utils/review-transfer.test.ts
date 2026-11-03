// 星號與待複習錯題的匯出與匯入：匯入先檢查再合併，檢查不過什麼都不寫，而且要說出原因。
import { describe, expect, it, vi } from 'vitest';
import {
  REVIEW_IMPORT_MAX_BYTES,
  buildReviewExport,
  countUnknownIds,
  parseReviewImport,
  readReviewImport,
  reviewExportFileName,
} from './review-transfer';
import { allQuestions } from '../data/questions';
import pool from '../data/practice_pool.json';

const good = (over: object = {}) => ({
  app: 'ipas-net-zero-quiz',
  schema: 1,
  exportedAt: '2026-11-01T00:00:00.000Z',
  stars: { 'gist-1': 10 },
  wrong: { 'pool-aig-x-1': { streak: 1, last: 20 } },
  ...over,
});
const parse = (x: unknown) => parseReviewImport(typeof x === 'string' ? x : JSON.stringify(x));
const reason = (x: unknown) => {
  const r = parse(x);
  if (r.ok) throw new Error('應該被拒絕');
  return r.reason;
};

describe('buildReviewExport', () => {
  it('約定的形狀：只有星號與待複習，不帶 seeded、不帶其他欄位', () => {
    const at = new Date('2026-11-01T01:02:03.000Z');
    const out = buildReviewExport(
      { stars: { a: 1 }, wrong: { b: { streak: 0, last: 2 } } },
      at
    );
    expect(JSON.parse(out)).toEqual({
      app: 'ipas-net-zero-quiz',
      schema: 1,
      exportedAt: '2026-11-01T01:02:03.000Z',
      stars: { a: 1 },
      wrong: { b: { streak: 0, last: 2 } },
    });
  });

  it('匯出的內容匯入得回來（認不得的 id 也留著）', () => {
    const text = buildReviewExport(
      { stars: { 'not-in-bank': 1 }, wrong: {} },
      new Date('2026-11-01T00:00:00.000Z')
    );
    expect(parseReviewImport(text)).toMatchObject({ ok: true, stars: { 'not-in-bank': 1 } });
  });

  it('檔名用本地日期：台灣的 11/1 早上在 UTC 還是 10/31', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'Asia/Taipei';
    try {
      expect(reviewExportFileName(new Date('2026-10-31T16:30:00.000Z'))).toBe('ipas-review-2026-11-01.json');
    } finally {
      process.env.TZ = tz;
    }
  });

  it('檔名的月日補零', () => {
    expect(reviewExportFileName(new Date(2026, 0, 5, 12))).toBe('ipas-review-2026-01-05.json');
  });
});

describe('parseReviewImport', () => {
  it('合法的檔案：回傳星號與待複習，認不得的 id 留著', () => {
    const r = parse(good());
    expect(r).toMatchObject({
      ok: true,
      stars: { 'gist-1': 10 },
      wrong: { 'pool-aig-x-1': { streak: 1, last: 20 } },
    });
  });

  it('兩邊都空的備份也算合法', () => {
    expect(parse(good({ stars: {}, wrong: {} })).ok).toBe(true);
  });

  it('多的欄位不帶進來', () => {
    const r = parse(good({ wrong: { a: { streak: 0, last: 1, evil: true } } }));
    expect(r.ok && r.wrong.a).toEqual({ streak: 0, last: 1 });
  });

  it('不是 JSON', () => {
    expect(reason('{oops')).toBe('這個檔案不是備份檔，內容無法讀取。');
  });

  for (const root of ['[]', 'null', '3', '"x"']) {
    it(`最外層不是物件：${root}`, () => {
      expect(reason(root)).toMatch(/不是這個網站的備份/);
    });
  }

  it('app 不對', () => {
    expect(reason(good({ app: 'other' }))).toMatch(/不是這個網站的備份/);
  });

  it('schema 比這個版本新', () => {
    expect(reason(good({ schema: 2 }))).toMatch(/新版/);
  });

  for (const schema of [0, '1', null]) {
    it(`schema 不對：${JSON.stringify(schema)}`, () => {
      expect(reason(good({ schema }))).toMatch(/格式版本/);
    });
  }

  for (const exportedAt of [undefined, 5, 'yesterday-ish']) {
    it(`exportedAt 不對：${JSON.stringify(exportedAt)}`, () => {
      expect(reason(good({ exportedAt }))).toMatch(/匯出時間/);
    });
  }

  for (const stars of [undefined, null, [], 'x', 3]) {
    it(`stars 不是物件：${JSON.stringify(stars)}`, () => {
      expect(reason(good({ stars }))).toMatch(/星號/);
    });
  }

  for (const wrong of [undefined, null, [], 'x', 3]) {
    it(`wrong 不是物件：${JSON.stringify(wrong)}`, () => {
      expect(reason(good({ wrong }))).toMatch(/待複習/);
    });
  }

  for (const value of ['10', null, {}, true, -1]) {
    it(`星號的時間不是數字：${JSON.stringify(value)}`, () => {
      expect(reason(good({ stars: { 'gist-1': value } }))).toMatch(/gist-1/);
    });
  }

  for (const entry of [
    1,
    null,
    [],
    {},
    { streak: 0 },
    { last: 1 },
    { streak: '0', last: 1 },
    { streak: 0, last: '1' },
    { streak: 2, last: 1 },
    { streak: -1, last: 1 },
    { streak: 0.5, last: 1 },
  ]) {
    it(`待複習的紀錄不對：${JSON.stringify(entry)}`, () => {
      expect(reason(good({ wrong: { 'gist-1': entry } }))).toMatch(/gist-1/);
    });
  }

  for (const id of ['', 'a b', 'a/b', 'a.b', '題目', '<img>', 'x'.repeat(81)]) {
    it(`id 的字元或長度不對：${JSON.stringify(id.slice(0, 12))}`, () => {
      expect(reason(good({ stars: { [id]: 1 } }))).toMatch(/^備份裡有無法辨識的題目編號/);
      expect(reason(good({ stars: {}, wrong: { [id]: { streak: 0, last: 1 } } }))).toMatch(/^備份裡有無法辨識的題目編號/);
    });
  }

  it('80 個字元的 id 可以', () => {
    expect(parse(good({ stars: { ['x'.repeat(80)]: 1 } })).ok).toBe(true);
  });

  // 物件字面值寫不出自己的 __proto__ 屬性，這裡一定要用字串
  for (const id of ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf']) {
    it(`拒絕 ${id}（星號與待複習都是）`, () => {
      const stars = String.raw`{"app":"ipas-net-zero-quiz","schema":1,"exportedAt":"2026-11-01T00:00:00.000Z","stars":{"${id}":1},"wrong":{}}`;
      expect(reason(stars)).toMatch(/無法辨識的題目編號/);
      const wrong = String.raw`{"app":"ipas-net-zero-quiz","schema":1,"exportedAt":"2026-11-01T00:00:00.000Z","stars":{},"wrong":{"${id}":{"streak":0,"last":1}}}`;
      expect(reason(wrong)).toMatch(/無法辨識的題目編號/);
    });
  }

  it('訊息裡的 id 截短：檔案內容不該整段印到畫面上', () => {
    expect(reason(good({ stars: { ['x'.repeat(5000)]: 1 } })).length).toBeLessThan(120);
    expect(reason(good({ wrong: { ['x'.repeat(5000)]: { streak: 0, last: 1 } } })).length).toBeLessThan(120);
  });

  it('題庫與練習池每一個真實的 id 都過得了檢查：id 的格式改了要在這裡先紅', () => {
    const ids = [...allQuestions.map((q) => q.id), ...pool.items.map((i) => i.id)];
    expect(ids.length).toBeGreaterThan(1000);
    const stars = Object.fromEntries(ids.map((id) => [id, 1]));
    const r = parse(good({ stars, wrong: {} }));
    expect(r.ok ? Object.keys(r.stars).length : r.reason).toBe(ids.length);
  });
});

describe('readReviewImport', () => {
  it('讀檔、檢查', async () => {
    const r = await readReviewImport(new File([JSON.stringify(good())], 'b.json'));
    expect(r.ok).toBe(true);
  });

  it('超過大小上限：不讀內容就拒絕', async () => {
    const file = new File(['x'], 'b.json');
    Object.defineProperty(file, 'size', { value: REVIEW_IMPORT_MAX_BYTES + 1 });
    let read = false;
    file.text = () => {
      read = true;
      return Promise.resolve('');
    };
    const r = await readReviewImport(file);
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/太大/) });
    expect(read).toBe(false);
  });

  it('剛好在上限上可以', async () => {
    const text = JSON.stringify(good());
    const file = new File([text], 'b.json');
    Object.defineProperty(file, 'size', { value: REVIEW_IMPORT_MAX_BYTES });
    expect((await readReviewImport(file)).ok).toBe(true);
  });

  it('計算題庫裡找不到的 id', () => {
    expect(countUnknownIds({ stars: { a: 1, x: 2 }, wrong: { a: { streak: 0, last: 1 }, y: { streak: 0, last: 1 } } }, new Set(['a']))).toBe(2);
    expect(countUnknownIds({ stars: { a: 1 }, wrong: {} }, new Set(['a']))).toBe(0);
    // 同一題同時在星號與待複習裡，算一題
    expect(countUnknownIds({ stars: { x: 1 }, wrong: { x: { streak: 0, last: 1 } } }, new Set())).toBe(1);
  });

  it('讀檔失敗', async () => {
    const file = new File(['x'], 'b.json');
    file.text = () => Promise.reject(new Error('gone'));
    expect(await readReviewImport(file)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/讀不到/),
    });
  });
});

describe('改過 id 的題目', () => {
  // 2026-10-18：S1-p01-q004 改成 S_IPAS_SAMPLE_114_L11-q004。改名前匯出的備份帶著舊 id
  const OLD = 'S1-p01-q004';
  const CUR = 'S_IPAS_SAMPLE_114_L11-q004';
  const bank = new Set([...allQuestions.map((q) => q.id), ...pool.items.map((i) => i.id)]);

  it('匯入時換成現在的 id，題庫找得到，不算「題庫找不到」', () => {
    const r = parse(good({ stars: { [OLD]: 10 }, wrong: { [OLD]: { streak: 1, last: 20 } } }));
    if (!r.ok) throw new Error(r.reason);
    expect({ ...r.stars }).toEqual({ [CUR]: 10 });
    expect({ ...r.wrong }).toEqual({ [CUR]: { streak: 1, last: 20 } });
    expect(countUnknownIds(r, bank)).toBe(0);
  });

  it('備份裡新舊 id 都有：留時間新的', () => {
    const r = parse(
      good({
        stars: { [OLD]: 30, [CUR]: 10 },
        wrong: { [OLD]: { streak: 1, last: 10 }, [CUR]: { streak: 0, last: 30 } },
      })
    );
    if (!r.ok) throw new Error(r.reason);
    expect({ ...r.stars }).toEqual({ [CUR]: 30 });
    expect({ ...r.wrong }).toEqual({ [CUR]: { streak: 0, last: 30 } });
  });
});

describe('時間的範圍', () => {
  const EXPORTED = '2026-11-01T00:00:00.000Z';
  const exportedAt = Date.parse(EXPORTED);

  for (const at of [1e300, 8_640_000_000_000_001]) {
    it(`超出 Date 範圍的時間：整份拒絕（${at}）`, () => {
      expect(reason(good({ stars: { 'gist-1': at } }))).toMatch(/星號的時間不對/);
      expect(reason(good({ stars: {}, wrong: { 'gist-1': { streak: 1, last: at } } }))).toMatch(/待複習的紀錄不對/);
    });
  }

  it('比匯出時間晚的時間改成匯出時間：備份裡的紀錄不會比匯出還新', () => {
    const r = parse(
      good({ exportedAt: EXPORTED, stars: { a: exportedAt + 5 }, wrong: { b: { streak: 1, last: 8_640_000_000_000_000 } } })
    );
    if (!r.ok) throw new Error(r.reason);
    expect(r.stars.a).toBe(exportedAt);
    expect(r.wrong.b).toEqual({ streak: 1, last: exportedAt });
  });

  it('匯出時間比現在晚（時鐘不準）：改成現在', () => {
    const now = exportedAt - 1000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const r = parse(good({ exportedAt: EXPORTED, stars: { a: exportedAt } }));
      expect(r.ok && r.stars.a).toBe(now);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('匯出的裝置時鐘比較快：整份往前移同樣的時間，備份裡的先後與間隔不變', () => {
    const HOUR = 3_600_000;
    const now = exportedAt - HOUR;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const r = parse(
        good({
          exportedAt: EXPORTED,
          stars: { a: exportedAt - 30 * 60_000, b: exportedAt, early: HOUR / 2 },
          wrong: { c: { streak: 1, last: exportedAt - 10 * 60_000 } },
        })
      );
      if (!r.ok) throw new Error(r.reason);
      expect(r.stars.a).toBe(now - 30 * 60_000);
      expect(r.stars.b).toBe(now);
      // 移過頭的時間不會變成負的（負的時間下一次讀就是壞資料）
      expect(r.stars.early).toBe(0);
      expect(r.wrong.c).toEqual({ streak: 1, last: now - 10 * 60_000 });
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('大小上限', () => {
  it('每一題都加星號又都在待複習的完整匯出（時間是真實的 13 位數）匯入得了', async () => {
    const ids = [...allQuestions.map((q) => q.id), ...pool.items.map((i) => i.id)];
    const at = Date.parse('2026-11-01T00:00:00.000Z');
    const text = buildReviewExport(
      {
        stars: Object.fromEntries(ids.map((id, i) => [id, at - i])),
        wrong: Object.fromEntries(ids.map((id, i) => [id, { streak: 1, last: at - i }])),
      },
      new Date('2026-11-02T00:00:00.000Z')
    );
    const file = new File([text], 'b.json');
    // 前提：比 100 KB 大。上限設得太緊，備份就匯不回來
    expect(file.size).toBeGreaterThan(100 * 1024);
    const r = await readReviewImport(file);
    expect(r.ok ? Object.keys(r.stars).length : r.reason).toBe(new Set(ids).size);
  });
});
