// 星號與待複習錯題的儲存層（Discussion #1）。
// 最重要的是 lost update：兩個分頁各加一顆星，兩顆都要留下；讀不懂的資料一個字都不能被覆寫。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REVIEW_CORRUPT_KEY,
  REVIEW_STORAGE_KEY,
  __resetReviewStoreForTesting,
  clearStars,
  clearWrong,
  getButtonNotice,
  getButtonNoticeEvent,
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
import { buildReviewExport, parseReviewImport } from './review-transfer';
import { currentQuestionId } from '../data/renamed-questions';
import { getQuestionById } from '../data/questions';
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

  it('setItem 丟例外：回傳 false，快照不變，在按下的那顆星號上通知使用者；同一顆的下一次成功就收掉', () => {
    const restore = failWrites();
    const listener = vi.fn();
    const off = subscribeReview(listener);
    expect(setStar('a', true)).toBe(false);
    expect(isStarred(getReviewSnapshot(), 'a')).toBe(false);
    expect(getButtonNotice('star', 'a')).toBe('write-failed');
    expect(getReviewNotice()).toBeNull();
    expect(listener).toHaveBeenCalled();
    restore();
    expect(setStar('a', true)).toBe(true);
    expect(getButtonNotice('star', 'a')).not.toBe('write-failed');
    off();
  });

  it('getItem 丟例外時不寫入：讀不到現況就可能蓋掉資料', () => {
    const spy = vi.spyOn(localStorage, 'setItem');
    localStorage.getItem = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    expect(setStar('a', true)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(getButtonNotice('star', 'a')).toBe('write-failed');
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
    // 是按星號才發現的：說在那顆星號下面，不加在頁面最上面
    expect(getButtonNotice('star', 'a')).toBe('recovered');
    expect(getReviewNotice()).toBeNull();
    // 同一顆的下一次寫入成功就收掉；開站時的帶入、別顆星號都不算
    seedReview();
    setStar('b', true);
    expect(getButtonNotice('star', 'a')).toBe('recovered');
    setStar('a', false);
    expect(getButtonNotice('star', 'a')).toBeNull();
  });

  it('搬不出去時（配額用完）一個字都不動，回傳 false：讀不懂的資料不能被覆寫', () => {
    store.set(REVIEW_STORAGE_KEY, '{not json');
    failWrites((k) => k === REVIEW_CORRUPT_KEY);
    expect(setStar('a', true)).toBe(false);
    expect(store.get(REVIEW_STORAGE_KEY)).toBe('{not json');
    expect(store.has(REVIEW_CORRUPT_KEY)).toBe(false);
    expect(getReviewNotice()).toBe('corrupt-stuck');
    // 頁面上已經說不會儲存：星號下面不再說一次
    expect(getButtonNotice('star', 'a')).toBeNull();
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
    // 頁面上已經說只能讀取：按鈕下面不再說一次
    expect(getButtonNotice('star', 'x')).toBeNull();
    expect(getButtonNotice('remove', 'b')).toBeNull();
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

describe('同一份備份匯入第二次，中間答錯過', () => {
  const MIN = 60_000;
  const T = Date.parse('2026-11-04T00:00:00.000Z');
  const at = (now: number) => vi.spyOn(Date, 'now').mockReturnValue(now);
  const importBackup = (text: string) => {
    const r = parseReviewImport(text);
    if (!r.ok) throw new Error(r.reason);
    return mergeReview(r);
  };

  it('時鐘都準：答錯的那一次留著，舊的連續答對次數不會回來', () => {
    put(v1({ wrong: { 'gist-1': { streak: 1, last: T - 10 * MIN } } }));
    at(T);
    const backup = buildReviewExport(getReviewSnapshot(), new Date(T));
    at(T + 10 * MIN);
    recordReviewResults([{ id: 'gist-1', isCorrect: false, at: T + 10 * MIN }]);
    at(T + 20 * MIN);
    importBackup(backup);
    __resetReviewStoreForTesting();
    expect(wrongEntry(getReviewSnapshot(), 'gist-1')).toEqual({ streak: 0, last: T + 10 * MIN });
  });

  it('匯出的裝置時鐘快一小時：一樣留著答錯的那一次', () => {
    // 那台裝置的 T+60 分匯出，備份裡記著它的 T+50 分連續答對一次
    const backup = JSON.stringify({
      app: 'ipas-net-zero-quiz',
      schema: 1,
      exportedAt: new Date(T + 60 * MIN).toISOString(),
      stars: {},
      wrong: { 'gist-1': { streak: 1, last: T + 50 * MIN } },
    });
    put(v1());
    at(T);
    importBackup(backup);
    at(T + 10 * MIN);
    recordReviewResults([{ id: 'gist-1', isCorrect: false, at: T + 10 * MIN }]);
    expect(wrongEntry(getReviewSnapshot(), 'gist-1')).toEqual({ streak: 0, last: T + 10 * MIN });
    // 再匯入時備份往前移 45 分，那一筆是 T+5 分，比答錯的 T+10 分舊（不是一樣新，不靠「一樣新留原本的」）
    at(T + 15 * MIN);
    importBackup(backup);
    __resetReviewStoreForTesting();
    expect(wrongEntry(getReviewSnapshot(), 'gist-1')).toEqual({ streak: 0, last: T + 10 * MIN });
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

  it('第一次加星號顯示在那顆星號上，記住已顯示過：取消再加不再顯示', () => {
    setStar('a', true);
    expect(getButtonNotice('star', 'a')).toBe('first-star');
    expect(getReviewNotice()).toBeNull();
    expect(store.get(seen)).toBe('1');
    setStar('a', false);
    expect(getButtonNotice('star', 'a')).toBeNull();
    setStar('a', true);
    expect(getButtonNotice('star', 'a')).toBeNull();
  });

  it('重新整理之後（新的模組狀態）也不再顯示', async () => {
    setStar('a', true);
    vi.resetModules();
    const reloaded = await import('./review-storage');
    reloaded.setStar('b', true);
    expect(reloaded.getButtonNotice('star', 'b')).toBeNull();
  });

  it('存不進去時不顯示：星號沒有加上', () => {
    failWrites((k) => k === REVIEW_STORAGE_KEY);
    setStar('a', true);
    expect(getButtonNotice('star', 'a')).toBe('write-failed');
    expect(store.has(seen)).toBe(false);
  });

  it('取消星號不算', () => {
    put(v1({ stars: { a: 1 } }));
    setStar('a', false);
    expect(getButtonNotice('star', 'a')).toBeNull();
  });
});

// 按鈕引起的提示排在那顆按鈕那一列下面（ReviewNotice.tsx）。收掉時它下面的東西往上移：別的按鈕的寫入收掉它的話，
// 排在它下面的那顆剛按的按鈕就從指標底下移走。所以只有同一顆按鈕的下一次寫入、換畫面、新的一場才收掉
describe('按鈕上的提示', () => {
  it('別顆按鈕的寫入不收掉：第一張錯題卡的提示留著，按第三張的星號時它不動', () => {
    setStar('a', true);
    expect(getButtonNotice('star', 'a')).toBe('first-star');
    setStar('c', true);
    expect(getButtonNotice('star', 'a')).toBe('first-star');
    expect(getButtonNotice('star', 'c')).toBeNull();
    put(v1({ stars: { a: 1, c: 1 }, wrong: { c: { streak: 0, last: 1 } } }));
    expect(removeFromReview('c')).toBe(true);
    expect(getButtonNotice('star', 'a')).toBe('first-star');
  });

  it('每一顆按鈕記自己的：兩顆都存不進去，兩顆下面都說', () => {
    failWrites();
    setStar('a', true);
    setStar('c', true);
    removeFromReview('a');
    expect(getButtonNotice('star', 'a')).toBe('write-failed');
    expect(getButtonNotice('star', 'c')).toBe('write-failed');
    // 移出待複習是另一顆按鈕：沒有東西可移出時也照樣寫一次，存不進去就說
    expect(getButtonNotice('remove', 'a')).toBe('write-failed');
    expect(getReviewNotice()).toBeNull();
  });

  it('頁面上的提示不被按鈕的寫入收掉：排在最上面，收掉的話剛按的按鈕會往上移', () => {
    store.set(REVIEW_STORAGE_KEY, '{broken');
    seedReview();
    expect(getReviewNotice()).toBe('recovered');
    expect(setStar('a', true)).toBe(true);
    expect(getReviewNotice()).toBe('recovered');
    const restore = failWrites();
    expect(recordReviewResults([{ id: 'x', isCorrect: false, at: 1 }])).toBeNull();
    expect(getReviewNotice()).toBe('write-failed');
    restore();
    expect(setStar('b', true)).toBe(true);
    expect(getReviewNotice()).toBe('write-failed');
    // 不是按鈕引起的寫入照舊：成功就收掉
    expect(recordReviewResults([{ id: 'x', isCorrect: false, at: 2 }])).not.toBeNull();
    expect(getReviewNotice()).toBeNull();
  });

  it('每一次提示都是新的一次（給螢幕閱讀器再念）：同一顆按鈕同一句話也換；沒有變動時同一個物件', () => {
    failWrites();
    setStar('a', true);
    const first = getButtonNoticeEvent('star', 'a');
    expect(first?.notice).toBe('write-failed');
    expect(getButtonNoticeEvent('star', 'a')).toBe(first);
    setStar('a', true);
    const second = getButtonNoticeEvent('star', 'a');
    expect(second?.notice).toBe('write-failed');
    expect(second?.seq).not.toBe(first?.seq);
    setStar('c', true);
    expect(getButtonNoticeEvent('star', 'a')).toBe(second);
    expect(getButtonNoticeEvent('star', 'c')?.seq).not.toBe(second?.seq);
  });
});

describe('設定頁的清除與匯入：由設定頁自己的狀態列說，不留提示', () => {
  const writes: [string, () => unknown][] = [
    ['clearStars', () => clearStars()],
    ['clearWrong', () => clearWrong()],
    ['mergeReview', () => mergeReview({ stars: { x: 1 }, wrong: {} })],
  ];

  it.each(writes)('%s 存不進去：回報失敗，頁面與按鈕都沒有提示，訂閱者不收到通知', (_, write) => {
    put(v1({ stars: { a: 1 }, wrong: { b: { streak: 0, last: 1 } } }));
    failWrites();
    const listener = vi.fn();
    const off = subscribeReview(listener);
    expect(write()).toBeFalsy();
    expect(getReviewNotice()).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it.each(writes)('%s 遇到搬不走的壞資料：一個字都不動，不記成頁面上的「目前不會儲存」', (_, write) => {
    store.set(REVIEW_STORAGE_KEY, '{broken');
    failWrites((k) => k.startsWith(REVIEW_CORRUPT_KEY));
    expect(write()).toBeFalsy();
    expect(store.get(REVIEW_STORAGE_KEY)).toBe('{broken');
    expect(getReviewNotice()).toBeNull();
  });

  it.each(writes)('%s 遇到壞資料：搬到 :corrupt 之後寫入，頁面上不加「已另存」', (_, write) => {
    store.set(REVIEW_STORAGE_KEY, '{broken');
    expect(write()).toBeTruthy();
    expect(store.get(REVIEW_CORRUPT_KEY)).toBe('{broken');
    expect(getReviewSnapshot().access).toBe('ok');
    expect(getReviewNotice()).toBeNull();
  });

  it.each(writes)('%s 不收掉頁面上已經有的提示（結束測驗時沒有儲存）', (_, write) => {
    const restore = failWrites();
    recordReviewResults([{ id: 'y', isCorrect: false, at: 1 }]);
    restore();
    expect(write()).toBeTruthy();
    expect(getReviewNotice()).toBe('write-failed');
  });
});

describe('提示的優先序與清除', () => {
  it('新版資料最重要：寫入失敗時也說只能讀取', () => {
    store.set(REVIEW_STORAGE_KEY, JSON.stringify({ v: 2 }));
    clearStars();
    expect(getReviewNotice()).toBe('newer');
  });

  it('寫入失敗比「已另存」重要', () => {
    store.set(REVIEW_STORAGE_KEY, '{broken');
    seedReview();
    expect(getReviewNotice()).toBe('recovered');
    failWrites();
    recordReviewResults([{ id: 'x', isCorrect: false, at: 1 }]);
    expect(getReviewNotice()).toBe('write-failed');
  });

  it('練習池的提醒排在寫入失敗之後；按鈕上的提示另外記，不擠掉頁面上的', () => {
    reportReviewPoolFailure();
    setStar('a', true);
    expect(getReviewNotice()).toBe('pool-failed');
    expect(getButtonNotice('star', 'a')).toBe('first-star');
    failWrites();
    recordReviewResults([{ id: 'x', isCorrect: false, at: 1 }]);
    expect(getReviewNotice()).toBe('write-failed');
  });

  it('同一顆按鈕：「已另存」比第一次加星號的提示重要', () => {
    store.set(REVIEW_STORAGE_KEY, '{broken');
    setStar('a', true);
    expect(getButtonNotice('star', 'a')).toBe('recovered');
    expect(store.get('ipas-review-star-hint-seen')).toBe('1');
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

  it('寫入失敗與第一次加星號的提示也收得掉，按鈕上的也一起', () => {
    const listener = vi.fn();
    const off = subscribeReview(listener);
    setStar('a', true);
    listener.mockClear();
    clearReviewNotices();
    expect(getButtonNotice('star', 'a')).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    const restore = failWrites();
    setStar('b', true);
    removeFromReview('b');
    clearStars();
    clearReviewNotices();
    expect(getReviewNotice()).toBeNull();
    expect(getButtonNotice('star', 'b')).toBeNull();
    expect(getButtonNotice('remove', 'b')).toBeNull();
    restore();
    off();
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

describe('改過 id 的題目：讀的時候算到現在的 id（與作答統計、進度相同）', () => {
  // 2026-10-18 真的發生過：參考樣題匯入時，S1-p01-q004 改成 S_IPAS_SAMPLE_114_L11-q004
  const OLD = 'S1-p01-q004';
  const CUR = 'S_IPAS_SAMPLE_114_L11-q004';

  it('前提：題庫記著這次改名，現在的 id 在主題庫裡，舊的不在', () => {
    expect(currentQuestionId(OLD)).toBe(CUR);
    expect(getQuestionById(CUR)).toBeDefined();
    expect(getQuestionById(OLD)).toBeUndefined();
  });

  it('星號與待複習：快照裡是現在的 id，舊 id 查不到', () => {
    put(v1({ stars: { [OLD]: 5 }, wrong: { [OLD]: { streak: 1, last: 6 } } }));
    const review = getReviewSnapshot();
    expect(review.access).toBe('ok');
    expect(Object.keys(review.stars)).toEqual([CUR]);
    expect(isStarred(review, CUR)).toBe(true);
    expect(isStarred(review, OLD)).toBe(false);
    expect(wrongEntry(review, CUR)).toEqual({ streak: 1, last: 6 });
    expect(wrongEntry(review, OLD)).toBeUndefined();
  });

  it('移出紀錄：舊 id 移出之前的作答，現在的 id 一樣不會加回', () => {
    put(v1({ removed: { [OLD]: 100 } }));
    expect(recordReviewResults([{ id: CUR, isCorrect: false, at: 50 }])).toEqual({ added: 0, removed: 0 });
    expect(stored().wrong).toEqual({});
  });

  it('新舊 id 都有：星號與移出紀錄留時間新的，待複習留 last 新的那一筆；與存的順序無關', () => {
    const both = [
      v1({
        stars: { [OLD]: 10, [CUR]: 5 },
        wrong: { [OLD]: { streak: 1, last: 10 }, [CUR]: { streak: 0, last: 20 } },
        removed: { [OLD]: 30, [CUR]: 10 },
      }),
      v1({
        stars: { [CUR]: 5, [OLD]: 10 },
        wrong: { [CUR]: { streak: 0, last: 20 }, [OLD]: { streak: 1, last: 10 } },
        removed: { [CUR]: 10, [OLD]: 30 },
      }),
    ];
    for (const data of both) {
      store.clear();
      __resetReviewStoreForTesting();
      put(data);
      const review = getReviewSnapshot();
      expect({ ...review.stars }).toEqual({ [CUR]: 10 });
      expect({ ...review.wrong }).toEqual({ [CUR]: { streak: 0, last: 20 } });
      // 移出時間是 30（舊 id 那一筆）：25 的答錯不加回，35 的才算
      expect(recordReviewResults([{ id: CUR, isCorrect: false, at: 25 }])).toEqual({ added: 0, removed: 0 });
    }
  });

  it('寫入時落地成現在的 id：存的資料裡不再有舊 id', () => {
    put(v1({ stars: { [OLD]: 5 }, wrong: { [OLD]: { streak: 0, last: 6 } }, removed: { [OLD]: 7 } }));
    expect(setStar('gist-1', true)).toBe(true);
    const raw = stored() as ReturnType<typeof stored> & { removed: Record<string, number> };
    expect(Object.keys(raw.stars).sort()).toEqual([CUR, 'gist-1'].sort());
    expect(Object.keys(raw.wrong)).toEqual([CUR]);
    expect(Object.keys(raw.removed)).toEqual([CUR]);
  });

  it('匯出的是現在的 id', () => {
    put(v1({ stars: { [OLD]: 5 }, wrong: { [OLD]: { streak: 0, last: 6 } } }));
    const out = JSON.parse(buildReviewExport(getReviewSnapshot(), new Date(0)));
    expect(Object.keys(out.stars)).toEqual([CUR]);
    expect(Object.keys(out.wrong)).toEqual([CUR]);
  });
});

describe('搬不走的壞資料，之後別的分頁修好了', () => {
  it('別的分頁重寫成讀得懂的資料：不等這邊寫入就收掉「目前不會儲存變更」，按星號時頁面最上面不會少一段', () => {
    store.set(REVIEW_STORAGE_KEY, '{broken');
    const restore = failWrites((k) => k.startsWith(REVIEW_CORRUPT_KEY));
    seedReview();
    expect(getReviewNotice()).toBe('corrupt-stuck');
    restore();
    put(v1());
    expect(getReviewNotice()).toBeNull();
  });

  it('這邊的寫入成功就收掉「目前不會儲存變更」', () => {
    store.set(REVIEW_STORAGE_KEY, '{broken');
    const restore = failWrites((k) => k.startsWith(REVIEW_CORRUPT_KEY));
    seedReview();
    expect(getReviewNotice()).toBe('corrupt-stuck');
    restore();
    // 另一個分頁清出空間之後重寫了這支 key
    put(v1());
    expect(setStar('gist-1', true)).toBe(true);
    expect(isStarred(getReviewSnapshot(), 'gist-1')).toBe(true);
    expect(getReviewNotice()).not.toBe('corrupt-stuck');
  });

  it('使用者沒有動手的寫入（開站帶入）成功也收掉', () => {
    store.set(REVIEW_STORAGE_KEY, '{broken');
    const restore = failWrites((k) => k.startsWith(REVIEW_CORRUPT_KEY));
    seedReview();
    restore();
    put(v1({ seeded: false }));
    expect(seedReview()).toBe(true);
    expect(getReviewNotice()).toBeNull();
  });
});

describe('時間的範圍：超出 Date 的算壞資料，比現在晚的改成現在', () => {
  const NOW = 1_800_000_000_000;
  const DATE_MAX = 8_640_000_000_000_000;

  it('超出 Date 範圍的時間算壞資料（星號、待複習、移出紀錄、場次）', () => {
    for (const data of [
      v1({ stars: { a: DATE_MAX + 1 } }),
      v1({ stars: { a: 1e300 } }),
      v1({ wrong: { a: { streak: 0, last: DATE_MAX + 1 } } }),
      v1({ removed: { a: 1e300 } }),
      v1({ sessions: [1e300] }),
    ]) {
      __resetReviewStoreForTesting();
      put(data);
      expect(getReviewSnapshot().access).toBe('corrupt');
    }
  });

  it('Date 範圍內但比現在晚：讀成現在，寫回去的也是現在', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    put(v1({ stars: { a: DATE_MAX }, wrong: { b: { streak: 1, last: NOW + 5 } }, removed: { c: NOW + 9 } }));
    const review = getReviewSnapshot();
    expect(review.access).toBe('ok');
    expect(review.stars.a).toBe(NOW);
    expect(wrongEntry(review, 'b')).toEqual({ streak: 1, last: NOW });
    expect(setStar('x', true)).toBe(true);
    const raw = stored() as ReturnType<typeof stored> & { removed: Record<string, number> };
    expect(raw.stars.a).toBe(NOW);
    expect(raw.wrong.b.last).toBe(NOW);
    expect(raw.removed.c).toBe(NOW);
  });

  it('作答時間比現在晚（時鐘調過）：記成現在', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const q = { id: 'a', answer: 'A', hasAnswer: true, qualityFlags: [] } as unknown as QuizQuestion;
    const answer = { questionId: 'a', selectedAnswer: 'B', correctAnswer: 'A', isCorrect: false, timestamp: NOW + 1000 } as AnswerRecord;
    expect(reviewResultsFrom([q], [answer])).toEqual([{ id: 'a', isCorrect: false, at: NOW }]);
  });

  it('舊統計的時間比現在晚：帶入時改成現在', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    store.set(STATS_KEY, JSON.stringify({ version: 1, items: { a: { attempts: 2, correct: 1, lastTriedAt: NOW * 2 } } }));
    seedReview();
    expect(stored().wrong.a).toEqual({ streak: 0, last: NOW });
  });
});

describe('同一場只記一次：場次紀錄的上限與順序', () => {
  const a = (isCorrect: boolean, at: number) => [{ id: 'a', isCorrect, at }];

  it('分頁 A 完成一場、又做了兩場，分頁 B 才完成同一份進度：只算一次', () => {
    put(v1({ wrong: { a: { streak: 0, last: 1 } } }));
    recordReviewResults(a(true, 10), 111); // 分頁 A：a 答對，streak 1
    recordReviewResults([{ id: 'b', isCorrect: false, at: 20 }], 222);
    recordReviewResults([{ id: 'c', isCorrect: false, at: 30 }], 333);
    // 分頁 B 完成 111 那一場：再算一次的話 a 就答對兩次而移出
    expect(recordReviewResults(a(true, 10), 111)).toEqual({ added: 0, removed: 0 });
    expect(stored().wrong.a).toEqual({ streak: 1, last: 10 });
  });

  it('第 51 場之後，最新的那一場重複完成還是只算一次', () => {
    put(v1({ wrong: { a: { streak: 0, last: 1 } } }));
    for (let t = 1; t <= 50; t++) recordReviewResults([{ id: `q${t}`, isCorrect: false, at: t }], t);
    recordReviewResults(a(true, 100), 51);
    expect(recordReviewResults(a(true, 100), 51)).toEqual({ added: 0, removed: 0 });
    expect(stored().wrong.a).toEqual({ streak: 1, last: 100 });
  });
});

describe('重新匯入同一份備份', () => {
  const backup = (last: number) =>
    JSON.stringify({
      app: 'ipas-net-zero-quiz',
      schema: 1,
      exportedAt: '2026-11-01T00:00:00.000Z',
      stars: {},
      wrong: { q: { streak: 1, last } },
    });
  const importText = (text: string) => {
    const parsed = parseReviewImport(text);
    if (!parsed.ok) return parsed.reason;
    return mergeReview(parsed);
  };

  it('備份裡的時間在未來：匯入之後答錯，再匯入一次不會把連續答對次數帶回來', () => {
    const exported = Date.parse('2026-11-01T00:00:00.000Z');
    vi.spyOn(Date, 'now').mockReturnValue(exported + 1000);
    expect(importText(backup(8_640_000_000_000_000))).toEqual({ stars: 0, wrong: 1 });
    recordReviewResults([{ id: 'q', isCorrect: false, at: exported + 2000 }], 1);
    expect(stored().wrong.q).toEqual({ streak: 0, last: exported + 2000 });
    vi.spyOn(Date, 'now').mockReturnValue(exported + 3000);
    importText(backup(8_640_000_000_000_000));
    expect(stored().wrong.q).toEqual({ streak: 0, last: exported + 2000 });
  });

  it('超出 Date 範圍的時間（1e300）：整份拒絕，什麼都不寫', () => {
    expect(importText(backup(1e300))).toMatch(/待複習的紀錄不對/);
    expect(store.has(REVIEW_STORAGE_KEY)).toBe(false);
  });
});

describe('第一次加星號時請瀏覽器保留資料：不跳詢問視窗', () => {
  // Firefox 對 persist() 跳詢問視窗（MDN：「the user is notified with a UI popup」；Firefox 157 實測 persist() 一直等著）。
  // Chrome 與 Safari 不問；Chrome 沒允許過時 permissions.query 也回 'prompt'，所以不能只看它
  const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0';
  const CHROME =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const stub = (userAgent: string, state: PermissionState | Error | null) => {
    const persist = vi.fn(() => Promise.resolve(true));
    const query = vi.fn(() => (state instanceof Error ? Promise.reject(state) : Promise.resolve({ state })));
    vi.stubGlobal('navigator', {
      userAgent,
      storage: { persist },
      ...(state === null ? {} : { permissions: { query } }),
    });
    return { persist, query };
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Firefox、還沒允許過：不呼叫 persist()，星號照樣加上', async () => {
    const { persist, query } = stub(FIREFOX, 'prompt');
    expect(setStar('a', true)).toBe(true);
    await flush();
    expect(query).toHaveBeenCalledWith({ name: 'persistent-storage' });
    expect(persist).not.toHaveBeenCalled();
  });

  it('Firefox、已經允許過：呼叫（不會再問）', async () => {
    const { persist } = stub(FIREFOX, 'granted');
    setStar('a', true);
    await flush();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('Firefox、沒有 Permissions API 或查詢失敗：不呼叫', async () => {
    for (const state of [null, new TypeError('bad name')]) {
      clearStars();
      const { persist } = stub(FIREFOX, state);
      expect(setStar('a', true)).toBe(true);
      await flush();
      expect(persist).not.toHaveBeenCalled();
    }
  });

  it('Chrome：照呼叫，不必先查（它不問）', async () => {
    const { persist, query } = stub(CHROME, 'prompt');
    setStar('a', true);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
  });
});
