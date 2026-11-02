// 星號與待複習錯題的儲存層（Discussion #1）。
// 最重要的是 lost update：兩個分頁各加一顆星，兩顆都要留下；讀不懂的資料一個字都不能被覆寫。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REVIEW_CORRUPT_KEY,
  REVIEW_STORAGE_KEY,
  __resetReviewStoreForTesting,
  clearStars,
  clearWrong,
  getReviewNotice,
  getReviewSnapshot,
  isStarred,
  mergeReview,
  recordReviewResults,
  removeFromReview,
  reviewResultsFrom,
  reportReviewPoolFailure,
  clearReviewNotices,
  previewMerge,
  seedReview,
  setStar,
  subscribeReview,
  wrongEntry,
} from './review-storage';
import { clearStats, recordAttempts } from './question-stats-storage';
import { installRealLocalStorage } from './__fixtures__/real-local-storage';
import type { AnswerRecord, QuizQuestion } from '../types/quiz';

const STATS_KEY = 'ipas-question-stats';

let store: Map<string, string>;
const installStorage = () => {
  store = installRealLocalStorage();
};

const stored = (): { v: number; seeded: boolean; stars: Record<string, number>; wrong: Record<string, { streak: number; last: number }> } =>
  JSON.parse(store.get(REVIEW_STORAGE_KEY)!);
const put = (data: unknown) => store.set(REVIEW_STORAGE_KEY, JSON.stringify(data));
const v1 = (over: object = {}) => ({ v: 1, seeded: true, stars: {}, wrong: {}, ...over });

function failWrites(match: (key: string) => boolean = () => true) {
  const original = localStorage.setItem;
  localStorage.setItem = (k: string, v: string) => {
    if (match(k)) throw new DOMException('quota', 'QuotaExceededError');
    original(k, v);
  };
  return () => {
    localStorage.setItem = original;
  };
}

beforeAll(installStorage);

beforeEach(() => {
  store.clear();
  __resetReviewStoreForTesting();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  installStorage();
});

describe('讀取', () => {
  it('沒有資料時是空的，不寫入', () => {
    const s = getReviewSnapshot();
    expect(s).toMatchObject({ access: 'ok', seeded: false, stars: {}, wrong: {} });
    expect(store.size).toBe(0);
  });

  it('快照依原始字串快取：內容沒變回傳同一個物件（useSyncExternalStore 才不會無限 render），變了才換', () => {
    put(v1({ stars: { a: 1 } }));
    const first = getReviewSnapshot();
    expect(getReviewSnapshot()).toBe(first);
    put(v1({ stars: { a: 1, b: 2 } }));
    const second = getReviewSnapshot();
    expect(second).not.toBe(first);
    expect(Object.keys(second.stars)).toEqual(['a', 'b']);
  });

  it('getItem 丟例外時回傳空快照，兩次是同一個物件，不往外丟', () => {
    localStorage.getItem = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    const s = getReviewSnapshot();
    expect(s).toMatchObject({ access: 'unavailable', stars: {}, wrong: {} });
    expect(getReviewSnapshot()).toBe(s);
  });

  it('localStorage 這個 getter 本身丟例外時也一樣', () => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
      configurable: true,
    });
    expect(getReviewSnapshot().access).toBe('unavailable');
    expect(setStar('a', true)).toBe(false);
  });

  it('getItem 回傳 undefined（測試環境的空 mock）等同沒有資料', () => {
    localStorage.getItem = (() => undefined) as unknown as typeof localStorage.getItem;
    expect(getReviewSnapshot()).toMatchObject({ access: 'ok', stars: {} });
  });
});

describe('寫入', () => {
  it('setStar 寫入約定的形狀；時間是當下', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    expect(setStar('a', true)).toBe(true);
    expect(stored()).toMatchObject({ v: 1, stars: { a: 1000 }, wrong: {} });
    expect(isStarred(getReviewSnapshot(), 'a')).toBe(true);
  });

  it('已經有星號的題目再加一次，時間不變；取消就刪掉', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    setStar('a', true);
    vi.spyOn(Date, 'now').mockReturnValue(2000);
    setStar('a', true);
    expect(stored().stars.a).toBe(1000);
    setStar('a', false);
    expect(stored().stars).toEqual({});
  });

  it('沒有星號的題目取消星號：沒有變動就不寫入', () => {
    put(v1());
    const before = store.get(REVIEW_STORAGE_KEY);
    const spy = vi.spyOn(localStorage, 'setItem');
    expect(setStar('a', false)).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(store.get(REVIEW_STORAGE_KEY)).toBe(before);
  });

  it('兩個分頁各加一顆星：兩顆都留下（兩份獨立的模組狀態，共用同一個 localStorage）', async () => {
    vi.resetModules();
    const tabA = await import('./review-storage');
    vi.resetModules();
    const tabB = await import('./review-storage');
    expect(tabA.setStar).not.toBe(tabB.setStar);

    // 兩邊都先讀過：快取的快照都是空的。寫入時若沿用快照，後寫的那一邊會把先寫的蓋掉
    expect(tabA.getReviewSnapshot().stars).toEqual({});
    expect(tabB.getReviewSnapshot().stars).toEqual({});

    expect(tabA.setStar('from-tab-a', true)).toBe(true);
    expect(tabB.setStar('from-tab-b', true)).toBe(true);

    expect(Object.keys(stored().stars).sort()).toEqual(['from-tab-a', 'from-tab-b']);
    expect(Object.keys(tabA.getReviewSnapshot().stars).sort()).toEqual(['from-tab-a', 'from-tab-b']);
  });

  it('作答紀錄也要先重讀：另一個分頁剛加的星號不會被蓋掉', async () => {
    vi.resetModules();
    const tabA = await import('./review-storage');
    vi.resetModules();
    const tabB = await import('./review-storage');
    tabA.getReviewSnapshot();
    tabB.setStar('b', true);
    tabA.recordReviewResults([{ id: 'x', isCorrect: false, at: 5 }]);
    expect(stored()).toMatchObject({ stars: { b: expect.any(Number) }, wrong: { x: { streak: 0, last: 5 } } });
  });

  it('setItem 丟例外：回傳 false，快照不變，通知使用者；下一次成功就收掉', () => {
    const restore = failWrites();
    const listener = vi.fn();
    const off = subscribeReview(listener);
    expect(setStar('a', true)).toBe(false);
    expect(isStarred(getReviewSnapshot(), 'a')).toBe(false);
    expect(getReviewNotice()).toBe('write-failed');
    expect(listener).toHaveBeenCalled();
    restore();
    expect(setStar('a', true)).toBe(true);
    expect(getReviewNotice()).not.toBe('write-failed');
    off();
  });

  it('getItem 丟例外時不寫入：讀不到現況就可能蓋掉資料', () => {
    const spy = vi.spyOn(localStorage, 'setItem');
    localStorage.getItem = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    expect(setStar('a', true)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(getReviewNotice()).toBe('write-failed');
  });
});

describe('通知', () => {
  it('同一個分頁的寫入通知每一個訂閱者', () => {
    store.set('ipas-review-star-hint-seen', '1');
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeReview(a);
    const offB = subscribeReview(b);
    setStar('x', true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    setStar('y', true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    offB();
  });

  it('storage 事件：這支 key 與 null（localStorage.clear）才通知；別的 key 不通知；解除訂閱後不再通知', () => {
    const listener = vi.fn();
    const off = subscribeReview(listener);
    window.dispatchEvent(new StorageEvent('storage', { key: 'other' }));
    expect(listener).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent('storage', { key: REVIEW_STORAGE_KEY }));
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    window.dispatchEvent(new StorageEvent('storage', { key: REVIEW_STORAGE_KEY }));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('壞資料', () => {
  const corrupt = ['{not json', '[]', 'null', '1', '"text"'].concat(
    [
      { v: 1 },
      { v: 1, stars: [], wrong: {} },
      { v: 1, seeded: true, stars: { a: 'x' }, wrong: {} },
      { v: 1, seeded: true, stars: { a: null }, wrong: {} },
      { v: 1, seeded: true, stars: {}, wrong: { a: 1 } },
      { v: 1, seeded: true, stars: {}, wrong: { a: { streak: 2, last: 1 } } },
      { v: 1, seeded: true, stars: {}, wrong: { a: { streak: -1, last: 1 } } },
      { v: 1, seeded: true, stars: {}, wrong: { a: { streak: 0.5, last: 1 } } },
      { v: 1, seeded: true, stars: {}, wrong: { a: { streak: 0, last: 'x' } } },
      { v: 1, seeded: 'yes', stars: {}, wrong: {} },
      { v: 0, seeded: true, stars: {}, wrong: {} },
      { v: '1', seeded: true, stars: {}, wrong: {} },
    ].map((x) => JSON.stringify(x))
  );

  for (const raw of corrupt) {
    it(`讀不懂的內容算壞資料：${raw}`, () => {
      store.set(REVIEW_STORAGE_KEY, raw);
      const s = getReviewSnapshot();
      expect(s.access).toBe('corrupt');
      expect(s.stars).toEqual({});
      // 只是讀，什麼都不動
      expect(store.get(REVIEW_STORAGE_KEY)).toBe(raw);
      expect(store.has(REVIEW_CORRUPT_KEY)).toBe(false);
    });
  }

  it('第一次寫入前先把原始字串搬到 :corrupt，再從空的開始', () => {
    store.set(REVIEW_STORAGE_KEY, '{not json');
    store.set('ipas-review-star-hint-seen', '1');
    const order: string[] = [];
    const set = localStorage.setItem;
    localStorage.setItem = (k: string, v: string) => {
      order.push(k);
      set(k, v);
    };
    expect(setStar('a', true)).toBe(true);
    expect(order).toEqual([REVIEW_CORRUPT_KEY, REVIEW_STORAGE_KEY]);
    expect(store.get(REVIEW_CORRUPT_KEY)).toBe('{not json');
    expect(Object.keys(stored().stars)).toEqual(['a']);
    expect(getReviewSnapshot().access).toBe('ok');
    expect(getReviewNotice()).toBe('recovered');
    // 下一次使用者的寫入成功就收掉；開站時的帶入不算
    seedReview();
    expect(getReviewNotice()).toBe('recovered');
    setStar('b', true);
    expect(getReviewNotice()).not.toBe('recovered');
  });

  it('搬不出去時（配額用完）一個字都不動，回傳 false：讀不懂的資料不能被覆寫', () => {
    store.set(REVIEW_STORAGE_KEY, '{not json');
    failWrites((k) => k === REVIEW_CORRUPT_KEY);
    expect(setStar('a', true)).toBe(false);
    expect(store.get(REVIEW_STORAGE_KEY)).toBe('{not json');
    expect(store.has(REVIEW_CORRUPT_KEY)).toBe(false);
    expect(getReviewNotice()).toBe('corrupt-stuck');
  });

  it('removeItem 丟例外時不繼續寫：原始字串還在主 key 上', () => {
    store.set(REVIEW_STORAGE_KEY, '{not json');
    localStorage.removeItem = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    expect(setStar('a', true)).toBe(false);
    expect(store.get(REVIEW_STORAGE_KEY)).toBe('{not json');
  });

  it('第二次壞掉不蓋掉第一次搬走的內容', () => {
    store.set(REVIEW_STORAGE_KEY, 'first');
    setStar('a', true);
    store.set(REVIEW_STORAGE_KEY, 'second');
    setStar('b', true);
    store.set(REVIEW_STORAGE_KEY, 'third');
    setStar('c', true);
    expect(store.get(REVIEW_CORRUPT_KEY)).toBe('first');
    expect(store.get(`${REVIEW_CORRUPT_KEY}:2`)).toBe('second');
    expect(store.get(`${REVIEW_CORRUPT_KEY}:3`)).toBe('third');
  });

  it('同一份內容重新搬一次（上次搬完寫入失敗）不多佔一格', () => {
    store.set(REVIEW_STORAGE_KEY, 'same');
    store.set(REVIEW_CORRUPT_KEY, 'same');
    expect(setStar('a', true)).toBe(true);
    expect(store.has(`${REVIEW_CORRUPT_KEY}:2`)).toBe(false);
  });

  it('搬走之後主 key 寫入失敗：內容留在 :corrupt，沒有遺失', () => {
    store.set(REVIEW_STORAGE_KEY, '{not json');
    failWrites((k) => k === REVIEW_STORAGE_KEY);
    expect(setStar('a', true)).toBe(false);
    expect(store.get(REVIEW_CORRUPT_KEY)).toBe('{not json');
  });
});

describe('新版資料（v 大於 1）', () => {
  it('唯讀：能讀的照讀、警告、任何寫入都不做', () => {
    const raw = JSON.stringify({ v: 2, stars: { a: 7 }, wrong: { b: { streak: 1, last: 3 } }, extra: true });
    store.set(REVIEW_STORAGE_KEY, raw);
    const s = getReviewSnapshot();
    expect(s.access).toBe('newer');
    expect(isStarred(s, 'a')).toBe(true);
    expect(wrongEntry(s, 'b')).toEqual({ streak: 1, last: 3 });
    expect(getReviewNotice()).toBe('newer');

    const spy = vi.spyOn(localStorage, 'setItem');
    expect(setStar('x', true)).toBe(false);
    expect(removeFromReview('b')).toBe(false);
    expect(clearStars()).toBe(false);
    expect(clearWrong()).toBe(false);
    expect(seedReview()).toBe(false);
    expect(recordReviewResults([{ id: 'x', isCorrect: false, at: 1 }])).toBeNull();
    expect(mergeReview({ stars: { x: 1 }, wrong: {} })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(store.get(REVIEW_STORAGE_KEY)).toBe(raw);
    expect(store.has(REVIEW_CORRUPT_KEY)).toBe(false);
  });

  it('形狀不認得的新版資料也不算壞資料：看不到內容，但照樣不動', () => {
    const raw = JSON.stringify({ v: 3, stars: 'moved', wrong: [{ a: 1 }] });
    store.set(REVIEW_STORAGE_KEY, raw);
    const s = getReviewSnapshot();
    expect(s).toMatchObject({ access: 'newer', stars: {}, wrong: {} });
    expect(setStar('x', true)).toBe(false);
    expect(store.get(REVIEW_STORAGE_KEY)).toBe(raw);
    expect(store.has(REVIEW_CORRUPT_KEY)).toBe(false);
  });

  it('新版資料裡單一筆讀不懂時，其他筆照常顯示', () => {
    store.set(
      REVIEW_STORAGE_KEY,
      JSON.stringify({ v: 2, stars: { a: 1, bad: 'x' }, wrong: { b: { streak: 0, last: 1 }, c: 5 } })
    );
    const s = getReviewSnapshot();
    expect(Object.keys(s.stars)).toEqual(['a']);
    expect(Object.keys(s.wrong)).toEqual(['b']);
  });
});

describe('__proto__ 這類 id', () => {
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    it(`${id}：查不到就是查不到，存得進去也取得回來，不污染 Object.prototype`, () => {
      const s = getReviewSnapshot();
      expect(isStarred(s, id)).toBe(false);
      expect(wrongEntry(s, id)).toBeUndefined();

      expect(setStar(id, true)).toBe(true);
      expect(recordReviewResults([{ id, isCorrect: false, at: 9 }])).not.toBeNull();
      const after = getReviewSnapshot();
      expect(isStarred(after, id)).toBe(true);
      expect(wrongEntry(after, id)).toEqual({ streak: 0, last: 9 });
      // 存進 JSON 的是一般的 key
      expect(Object.keys(stored().stars)).toEqual([id]);
      expect(Object.keys(stored().wrong)).toEqual([id]);

      expect(({} as Record<string, unknown>).streak).toBeUndefined();
      expect(Object.getPrototypeOf(after.wrong)).toBeNull();

      expect(setStar(id, false)).toBe(true);
      expect(removeFromReview(id)).toBe(true);
      expect(isStarred(getReviewSnapshot(), id)).toBe(false);
      expect(wrongEntry(getReviewSnapshot(), id)).toBeUndefined();
    });
  }

  it('wrongEntry 查的是自己的屬性：傳入帶 prototype 的物件也不會誤判', () => {
    const plain = { stars: {}, wrong: {} };
    expect(isStarred(plain, 'constructor')).toBe(false);
    expect(wrongEntry(plain, 'constructor')).toBeUndefined();
  });

  it('JSON 裡既有的 __proto__ key 不會變成 prototype', () => {
    store.set(
      REVIEW_STORAGE_KEY,
      '{"v":1,"seeded":true,"stars":{"__proto__":5},"wrong":{"__proto__":{"streak":1,"last":2}}}'
    );
    const s = getReviewSnapshot();
    expect(s.access).toBe('ok');
    expect(isStarred(s, '__proto__')).toBe(true);
    expect(wrongEntry(s, '__proto__')).toEqual({ streak: 1, last: 2 });
  });
});

describe('作答紀錄', () => {
  const r = (id: string, isCorrect: boolean, at = 100) => ({ id, isCorrect, at });

  it('答錯：進待複習，連續答對次數歸零', () => {
    put(v1({ wrong: { a: { streak: 1, last: 1 } } }));
    expect(recordReviewResults([r('a', false, 50), r('b', false, 60)])).not.toBeNull();
    expect(stored().wrong).toEqual({ a: { streak: 0, last: 50 }, b: { streak: 0, last: 60 } });
  });

  it('答對：在待複習裡的加一，到 2 次就移出', () => {
    put(v1({ wrong: { a: { streak: 0, last: 1 } } }));
    recordReviewResults([r('a', true, 200)]);
    expect(stored().wrong).toEqual({ a: { streak: 1, last: 200 } });
    recordReviewResults([r('a', true, 300)]);
    expect(stored().wrong).toEqual({});
  });

  it('連續才算：對、錯、對不會移出', () => {
    put(v1({ wrong: { a: { streak: 0, last: 1 } } }));
    recordReviewResults([r('a', true)]);
    recordReviewResults([r('a', false)]);
    recordReviewResults([r('a', true, 400)]);
    expect(stored().wrong).toEqual({ a: { streak: 1, last: 400 } });
  });

  it('答對不在待複習裡的題目：什麼都不記', () => {
    put(v1());
    recordReviewResults([r('a', true)]);
    expect(stored().wrong).toEqual({});
  });

  it('星號一律不動：答對、答錯、移出都一樣', () => {
    put(v1({ stars: { a: 1, b: 2 }, wrong: { a: { streak: 1, last: 1 } } }));
    recordReviewResults([r('a', true), r('b', false)]);
    expect(stored().stars).toEqual({ a: 1, b: 2 });
  });

  it('沒有作答紀錄就不碰 storage', () => {
    const spy = vi.spyOn(localStorage, 'setItem');
    expect(recordReviewResults([])).toEqual({ added: 0, removed: 0 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('寫入失敗回傳 false', () => {
    failWrites();
    expect(recordReviewResults([r('a', false)])).toBeNull();
    expect(getReviewNotice()).toBe('write-failed');
  });
});

describe('reviewResultsFrom', () => {
  const q = (id: string, over: Partial<QuizQuestion> = {}): QuizQuestion =>
    ({ id, answer: 'A', hasAnswer: true, qualityFlags: [], ...over }) as QuizQuestion;
  const a = (id: string, selected: string | null, correct: string | null = 'A'): AnswerRecord =>
    ({
      questionId: id,
      selectedAnswer: selected,
      correctAnswer: correct,
      isCorrect: correct === null ? null : selected === correct,
      timestamp: 77,
    }) as AnswerRecord;

  it('只留作答過、可計分的題目', () => {
    const questions = [q('ok'), q('bad'), q('flagged', { qualityFlags: ['disputed_answer'] }), q('null', { answer: null }), q('skip'), q('stale')];
    const answers = [
      a('ok', 'A'),
      a('bad', 'B'),
      a('flagged', 'B'),
      a('null', 'B', null),
      a('skip', null),
      // 記錄時這題還沒有標準答案，之後才補上：這筆對錯不算數
      { ...a('stale', 'B'), isCorrect: null },
    ];
    expect(reviewResultsFrom(questions, answers)).toEqual([
      { id: 'ok', isCorrect: true, at: 77 },
      { id: 'bad', isCorrect: false, at: 77 },
    ]);
  });

  it('答案紀錄裡的題目不在這一場時不算', () => {
    expect(reviewResultsFrom([q('a')], [a('ghost', 'B')])).toEqual([]);
  });
});

describe('帶入舊的作答統計（只做一次）', () => {
  const stat = (attempts: number, correct: number, lastTriedAt: number) => ({ attempts, correct, lastTriedAt });
  const putStats = (items: object) => store.set(STATS_KEY, JSON.stringify({ version: 1, items }));

  it('correct 小於 attempts 的題目進待複習，last 是最後作答時間，然後標記 seeded', () => {
    putStats({ a: stat(3, 1, 111), b: stat(2, 2, 222), c: stat(1, 0, 333) });
    expect(seedReview()).toBe(true);
    expect(stored()).toMatchObject({
      seeded: true,
      wrong: { a: { streak: 0, last: 111 }, c: { streak: 0, last: 333 } },
    });
    expect(stored().wrong.b).toBeUndefined();
  });

  it('清空之後不會重新帶入', () => {
    putStats({ a: stat(3, 1, 111) });
    seedReview();
    clearWrong();
    expect(seedReview()).toBe(true);
    expect(stored().wrong).toEqual({});
    expect(stored().seeded).toBe(true);
  });

  it('答對兩次移出之後不會被帶回來', () => {
    putStats({ a: stat(3, 1, 111) });
    seedReview();
    recordReviewResults([{ id: 'a', isCorrect: true, at: 1 }]);
    recordReviewResults([{ id: 'a', isCorrect: true, at: 2 }]);
    seedReview();
    expect(stored().wrong).toEqual({});
  });

  it('沒有統計也標記 seeded：之後累積的統計不會被當成舊資料', () => {
    seedReview();
    expect(stored()).toMatchObject({ seeded: true, wrong: {} });
    putStats({ a: stat(3, 1, 111) });
    seedReview();
    expect(stored().wrong).toEqual({});
  });

  it('任何一次寫入都先帶入：寫入成功時不會留下 seeded=false', () => {
    putStats({ a: stat(3, 1, 111) });
    setStar('x', true);
    expect(stored()).toMatchObject({ seeded: true, wrong: { a: { streak: 0, last: 111 } } });
  });

  it('已經在待複習的題目不被舊統計蓋掉', () => {
    put({ ...v1({ wrong: { a: { streak: 1, last: 999 } } }), seeded: false });
    putStats({ a: stat(3, 1, 111) });
    seedReview();
    expect(stored().wrong.a).toEqual({ streak: 1, last: 999 });
  });

  it('寫入失敗時 seeded 不成立，也不打擾使用者：下次再試', () => {
    putStats({ a: stat(3, 1, 111) });
    const restore = failWrites();
    expect(seedReview()).toBe(false);
    expect(getReviewNotice()).toBeNull();
    restore();
    expect(seedReview()).toBe(true);
    expect(stored().seeded).toBe(true);
    expect(Object.keys(stored().wrong)).toEqual(['a']);
  });
});

describe('清除', () => {
  it('清除星號不動待複習；清除待複習不動星號；都保留 seeded', () => {
    put(v1({ stars: { a: 1 }, wrong: { b: { streak: 0, last: 1 } } }));
    clearStars();
    expect(stored()).toMatchObject({ seeded: true, stars: {}, wrong: { b: { streak: 0, last: 1 } } });
    put(v1({ stars: { a: 1 }, wrong: { b: { streak: 0, last: 1 } } }));
    clearWrong();
    expect(stored()).toMatchObject({ seeded: true, stars: { a: 1 }, wrong: {} });
  });

  it('跟作答統計互不影響', () => {
    recordAttempts([{ id: 'x', isCorrect: true, at: 1 }]);
    const stats = store.get(STATS_KEY);
    put(v1({ stars: { a: 1 }, wrong: { b: { streak: 0, last: 1 } } }));
    clearStars();
    clearWrong();
    expect(store.get(STATS_KEY)).toBe(stats);

    put(v1({ stars: { a: 1 } }));
    const review = store.get(REVIEW_STORAGE_KEY);
    clearStats();
    expect(store.has(STATS_KEY)).toBe(false);
    expect(store.get(REVIEW_STORAGE_KEY)).toBe(review);
  });

  it('移出待複習：只動那一題，星號不動', () => {
    put(v1({ stars: { a: 1 }, wrong: { a: { streak: 0, last: 1 }, b: { streak: 1, last: 2 } } }));
    expect(removeFromReview('a')).toBe(true);
    expect(stored().wrong).toEqual({ b: { streak: 1, last: 2 } });
    expect(stored().stars).toEqual({ a: 1 });
  });
});

describe('第一次加星號時請瀏覽器保留資料', () => {
  it('從零到一時呼叫一次，不等它；之後不再呼叫；取消星號不呼叫', () => {
    const persist = vi.fn(() => new Promise<boolean>(() => {}));
    vi.stubGlobal('navigator', { storage: { persist } });
    setStar('a', false);
    expect(persist).not.toHaveBeenCalled();
    expect(setStar('a', true)).toBe(true); // 永遠不 resolve 也不擋
    expect(persist).toHaveBeenCalledTimes(1);
    setStar('b', true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('寫入失敗時不呼叫', () => {
    const persist = vi.fn(() => Promise.resolve(true));
    vi.stubGlobal('navigator', { storage: { persist } });
    failWrites();
    setStar('a', true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('沒有這個 API、丟例外、Promise 被拒絕都不影響結果', () => {
    vi.stubGlobal('navigator', {});
    expect(setStar('a', true)).toBe(true);
    clearStars();

    vi.stubGlobal('navigator', {
      storage: {
        persist: () => {
          throw new Error('nope');
        },
      },
    });
    expect(setStar('b', true)).toBe(true);
    clearStars();

    // 沒接住的話是一筆 unhandled rejection，global-error-handlers 會當成錯誤記下來
    const rejection = Promise.reject(new Error('nope'));
    const caught = vi.spyOn(rejection, 'catch');
    vi.stubGlobal('navigator', { storage: { persist: () => rejection } });
    expect(setStar('c', true)).toBe(true);
    expect(caught).toHaveBeenCalled();
  });
});

describe('合併匯入的資料', () => {
  it('聯集；同一題留時間新的；不覆寫', () => {
    put(
      v1({
        stars: { keep: 5, older: 1, newer: 9 },
        wrong: { keep: { streak: 1, last: 5 }, older: { streak: 1, last: 1 }, newer: { streak: 0, last: 9 } },
      })
    );
    expect(
      mergeReview({
        stars: { add: 3, older: 2, newer: 2 },
        wrong: { add: { streak: 0, last: 3 }, older: { streak: 0, last: 2 }, newer: { streak: 1, last: 2 } },
      })
    ).toEqual({ stars: 1, wrong: 1 });
    expect(stored().stars).toEqual({ keep: 5, older: 2, newer: 9, add: 3 });
    expect(stored().wrong).toEqual({
      keep: { streak: 1, last: 5 },
      older: { streak: 0, last: 2 },
      newer: { streak: 0, last: 9 },
      add: { streak: 0, last: 3 },
    });
    expect(stored().seeded).toBe(true);
  });

  it('時間相同時留原本的', () => {
    put(v1({ wrong: { a: { streak: 1, last: 5 } } }));
    mergeReview({ stars: {}, wrong: { a: { streak: 0, last: 5 } } });
    expect(stored().wrong.a).toEqual({ streak: 1, last: 5 });
  });

  it('合併前先重讀：另一個分頁剛加的星號不會不見', () => {
    put(v1());
    getReviewSnapshot();
    put(v1({ stars: { other: 1 } }));
    mergeReview({ stars: { add: 2 }, wrong: {} });
    expect(Object.keys(stored().stars).sort()).toEqual(['add', 'other']);
  });

  it('寫入失敗回傳 false，內容不變', () => {
    put(v1({ stars: { a: 1 } }));
    const before = store.get(REVIEW_STORAGE_KEY);
    failWrites();
    expect(mergeReview({ stars: { b: 1 }, wrong: {} })).toBeNull();
    expect(store.get(REVIEW_STORAGE_KEY)).toBe(before);
  });
});

describe('合併的題數', () => {
  it('回傳實際新增的題數：只是時間更新的不算新增', () => {
    put(v1({ stars: { a: 1 }, wrong: { b: { streak: 0, last: 1 } } }));
    expect(mergeReview({ stars: { a: 9, c: 1 }, wrong: { b: { streak: 1, last: 9 } } })).toEqual({ stars: 1, wrong: 0 });
  });

  it('重複匯入：第二次是 0', () => {
    const incoming = { stars: { a: 1 }, wrong: { b: { streak: 0, last: 1 } } };
    expect(mergeReview(incoming)).toEqual({ stars: 1, wrong: 1 });
    expect(mergeReview(incoming)).toEqual({ stars: 0, wrong: 0 });
  });

  it('previewMerge 先算出同樣的數字，什麼都不寫', () => {
    put(v1({ stars: { a: 1 } }));
    const before = store.get(REVIEW_STORAGE_KEY);
    expect(previewMerge({ stars: { a: 2, b: 1 }, wrong: { c: { streak: 0, last: 1 } } })).toEqual({ stars: 1, wrong: 1 });
    expect(store.get(REVIEW_STORAGE_KEY)).toBe(before);
  });
});

describe('同一場裡手動移出', () => {
  const wrongAt = (at: number) => [{ id: 'a', isCorrect: false, at }];

  it('移出之前的作答不會在結束測驗時加回；移出之後答錯才算', () => {
    put(v1({ wrong: { a: { streak: 0, last: 1 } } }));
    vi.spyOn(Date, 'now').mockReturnValue(100);
    removeFromReview('a');
    recordReviewResults(wrongAt(99));
    expect(stored().wrong).toEqual({});
    recordReviewResults(wrongAt(100));
    expect(stored().wrong).toEqual({});
    recordReviewResults(wrongAt(101));
    expect(stored().wrong).toEqual({ a: { streak: 0, last: 101 } });
  });

  it('紀錄存在 localStorage：重新整理之後（新的模組狀態）一樣不加回', async () => {
    put(v1({ wrong: { a: { streak: 0, last: 1 } } }));
    vi.spyOn(Date, 'now').mockReturnValue(100);
    removeFromReview('a');
    vi.resetModules();
    const reloaded = await import('./review-storage');
    reloaded.recordReviewResults(wrongAt(50));
    expect(stored().wrong).toEqual({});
  });

  it('清除待複習也一樣：清單上的題目不會被清除前的作答加回', () => {
    put(v1({ wrong: { a: { streak: 0, last: 1 } } }));
    vi.spyOn(Date, 'now').mockReturnValue(100);
    clearWrong();
    recordReviewResults(wrongAt(50));
    expect(stored().wrong).toEqual({});
  });

  it('不在清單上的題目按移出不留紀錄', () => {
    put(v1());
    removeFromReview('a');
    expect(Object.keys(stored())).toEqual(['v', 'seeded', 'stars', 'wrong']);
  });

  it('沒有移出紀錄、沒有場次紀錄時，存的形狀只有四個欄位', () => {
    setStar('a', true);
    expect(Object.keys(stored())).toEqual(['v', 'seeded', 'stars', 'wrong']);
  });
});

describe('同一場只記一次', () => {
  const r = (isCorrect: boolean) => [{ id: 'a', isCorrect, at: 5 }];

  it('同一個 startTime 第二次不算：同一份進度在兩個分頁都完成，一場不會移出', () => {
    put(v1({ wrong: { a: { streak: 0, last: 1 } } }));
    recordReviewResults(r(true), 111);
    recordReviewResults(r(true), 111);
    expect(stored().wrong).toEqual({ a: { streak: 1, last: 5 } });
  });

  it('紀錄存在 localStorage：第二個分頁是另一份模組狀態', async () => {
    put(v1({ wrong: { a: { streak: 0, last: 1 } } }));
    vi.resetModules();
    const other = await import('./review-storage');
    recordReviewResults(r(true), 111);
    expect(other.recordReviewResults(r(true), 111)).toEqual({ added: 0, removed: 0 });
    expect(stored().wrong.a.streak).toBe(1);
  });

  it('不同場照算', () => {
    put(v1({ wrong: { a: { streak: 0, last: 1 } } }));
    recordReviewResults(r(true), 111);
    recordReviewResults(r(true), 222);
    expect(stored().wrong).toEqual({});
  });

  it('只留最近幾場，不會一直長大', () => {
    for (let t = 1; t <= 80; t++) recordReviewResults([{ id: `q${t}`, isCorrect: false, at: t }], t);
    expect((stored() as unknown as { sessions: number[] }).sessions.length).toBeLessThanOrEqual(50);
  });
});

describe('這一場的摘要', () => {
  it('幾題新進待複習、幾題移出；已經在清單上又答錯的不算新進', () => {
    put(v1({ wrong: { keep: { streak: 0, last: 1 }, leave: { streak: 1, last: 1 }, stay: { streak: 0, last: 1 } } }));
    expect(
      recordReviewResults([
        { id: 'new', isCorrect: false, at: 5 },
        { id: 'keep', isCorrect: false, at: 5 },
        { id: 'leave', isCorrect: true, at: 5 },
        { id: 'stay', isCorrect: true, at: 5 },
      ])
    ).toEqual({ added: 1, removed: 1 });
  });

  it('沒有加回的題目不算新進', () => {
    put(v1({ wrong: { a: { streak: 0, last: 1 } } }));
    vi.spyOn(Date, 'now').mockReturnValue(100);
    removeFromReview('a');
    expect(recordReviewResults([{ id: 'a', isCorrect: false, at: 50 }])).toEqual({ added: 0, removed: 0 });
  });
});

describe('讀跟寫同一套規則', () => {
  const putStats = (items: object) => store.set(STATS_KEY, JSON.stringify({ version: 1, items }));

  it('舊統計的時間是負的：帶入之後主資料還是讀得懂，星號加得上', () => {
    putStats({ a: { attempts: 2, correct: 1, lastTriedAt: -5 } });
    seedReview();
    expect(getReviewSnapshot().access).toBe('ok');
    expect(setStar('x', true)).toBe(true);
    expect(store.has(REVIEW_CORRUPT_KEY)).toBe(false);
    expect(Object.keys(stored().stars)).toEqual(['x']);
    expect(wrongEntry(getReviewSnapshot(), 'a')).toMatchObject({ streak: 0 });
  });

  it('進度裡的作答紀錄沒有 timestamp：寫出去的資料一樣讀得懂', () => {
    const q = { id: 'a', answer: 'A', hasAnswer: true, qualityFlags: [] } as unknown as QuizQuestion;
    const answer = { questionId: 'a', selectedAnswer: 'B', correctAnswer: 'A', isCorrect: false } as AnswerRecord;
    recordReviewResults(reviewResultsFrom([q], [answer]));
    expect(getReviewSnapshot().access).toBe('ok');
    expect(wrongEntry(getReviewSnapshot(), 'a')).toMatchObject({ streak: 0 });
  });

  it('JSON 裡的 1e999 不是有限的時間：算壞資料', () => {
    store.set(REVIEW_STORAGE_KEY, '{"v":1,"seeded":true,"stars":{"a":1e999},"wrong":{}}');
    expect(getReviewSnapshot().access).toBe('corrupt');
  });

  it('移出紀錄與場次紀錄也要讀得懂：形狀不對算壞資料', () => {
    store.set(REVIEW_STORAGE_KEY, JSON.stringify(v1({ removed: { a: 'x' } })));
    expect(getReviewSnapshot().access).toBe('corrupt');
    store.set(REVIEW_STORAGE_KEY, JSON.stringify(v1({ sessions: ['x'] })));
    expect(getReviewSnapshot().access).toBe('corrupt');
    store.set(REVIEW_STORAGE_KEY, JSON.stringify(v1({ sessions: 5 })));
    expect(getReviewSnapshot().access).toBe('corrupt');
  });
});

describe('壞資料之後從空的開始', () => {
  it('不重新帶入舊統計：畫面說從空的開始，實際上也是空的', () => {
    store.set(STATS_KEY, JSON.stringify({ version: 1, items: { a: { attempts: 2, correct: 1, lastTriedAt: 5 } } }));
    store.set(REVIEW_STORAGE_KEY, '{broken');
    seedReview();
    expect(stored()).toMatchObject({ seeded: true, wrong: {} });
    expect(Object.keys(stored().wrong)).toEqual([]);
    expect(getReviewNotice()).toBe('recovered');
  });
});

describe('搬不走的壞資料', () => {
  it('開站時就告訴使用者，訂閱者收得到；寫入照樣不做', () => {
    store.set(REVIEW_STORAGE_KEY, '{broken');
    failWrites((k) => k === REVIEW_CORRUPT_KEY);
    const listener = vi.fn();
    const off = subscribeReview(listener);
    expect(seedReview()).toBe(false);
    expect(getReviewNotice()).toBe('corrupt-stuck');
    expect(listener).toHaveBeenCalled();
    expect(store.get(REVIEW_STORAGE_KEY)).toBe('{broken');
    off();
  });

  it('之後搬得走了就收掉', () => {
    store.set(REVIEW_STORAGE_KEY, '{broken');
    const restore = failWrites((k) => k === REVIEW_CORRUPT_KEY);
    seedReview();
    restore();
    seedReview();
    expect(getReviewNotice()).toBe('recovered');
  });
});

describe('第一次加星號的提示', () => {
  const seen = 'ipas-review-star-hint-seen';

  it('第一次加星號顯示，記住已顯示過：取消再加不再顯示', () => {
    setStar('a', true);
    expect(getReviewNotice()).toBe('first-star');
    expect(store.get(seen)).toBe('1');
    setStar('a', false);
    expect(getReviewNotice()).toBeNull();
    setStar('a', true);
    expect(getReviewNotice()).toBeNull();
  });

  it('重新整理之後（新的模組狀態）也不再顯示', async () => {
    setStar('a', true);
    vi.resetModules();
    const reloaded = await import('./review-storage');
    reloaded.setStar('b', true);
    expect(reloaded.getReviewNotice()).toBeNull();
  });

  it('存不進去時不顯示：星號沒有加上', () => {
    failWrites((k) => k === REVIEW_STORAGE_KEY);
    setStar('a', true);
    expect(getReviewNotice()).toBe('write-failed');
    expect(store.has(seen)).toBe(false);
  });

  it('取消星號不算', () => {
    put(v1({ stars: { a: 1 } }));
    setStar('a', false);
    expect(getReviewNotice()).toBeNull();
  });
});

describe('提示的優先序與清除', () => {
  it('新版資料最重要：寫入失敗時也說只能讀取', () => {
    store.set(REVIEW_STORAGE_KEY, JSON.stringify({ v: 2 }));
    setStar('a', true);
    expect(getReviewNotice()).toBe('newer');
  });

  it('寫入失敗比「已另存」重要', () => {
    store.set(REVIEW_STORAGE_KEY, '{broken');
    seedReview();
    expect(getReviewNotice()).toBe('recovered');
    failWrites();
    setStar('a', true);
    expect(getReviewNotice()).toBe('write-failed');
  });

  it('練習池的提醒排在寫入失敗之後，第一次加星號的提示排最後', () => {
    reportReviewPoolFailure();
    setStar('a', true);
    expect(getReviewNotice()).toBe('pool-failed');
    failWrites();
    setStar('b', true);
    expect(getReviewNotice()).toBe('write-failed');
  });

  it('clearReviewNotices 收掉會過時的提示，訂閱者收到通知；沒有東西可收時不通知', () => {
    const listener = vi.fn();
    const off = subscribeReview(listener);
    clearReviewNotices();
    expect(listener).not.toHaveBeenCalled();
    reportReviewPoolFailure();
    listener.mockClear();
    clearReviewNotices();
    expect(getReviewNotice()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it('寫入失敗與第一次加星號的提示也收得掉', () => {
    setStar('a', true);
    clearReviewNotices();
    expect(getReviewNotice()).toBeNull();
    const restore = failWrites();
    setStar('b', true);
    clearReviewNotices();
    expect(getReviewNotice()).toBeNull();
    restore();
  });

  it('收不掉現況：新版資料、搬不走的壞資料還是要說', () => {
    store.set(REVIEW_STORAGE_KEY, JSON.stringify({ v: 2 }));
    clearReviewNotices();
    expect(getReviewNotice()).toBe('newer');
    store.set(REVIEW_STORAGE_KEY, '{broken');
    failWrites((k) => k === REVIEW_CORRUPT_KEY);
    seedReview();
    reportReviewPoolFailure(); // 有別的提示可收，clearReviewNotices 才會真的動手
    clearReviewNotices();
    expect(getReviewNotice()).toBe('corrupt-stuck');
  });
});

describe('練習池載入失敗的提醒', () => {
  it('回報之後看得到，訂閱者收到通知', () => {
    const listener = vi.fn();
    const off = subscribeReview(listener);
    reportReviewPoolFailure();
    expect(getReviewNotice()).toBe('pool-failed');
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });
});
