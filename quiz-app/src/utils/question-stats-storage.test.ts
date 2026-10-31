// question-stats-storage 測試（Refs #64）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadStats,
  recordAttempts,
  clearStats,
  selectWeakQuestions,
  type QuestionStat,
} from './question-stats-storage';
import dataset from '../data/integrated_dataset.json';

// 真實 Map-based localStorage mock — test-setup 裡的 vi.fn() 不會保存值
function installLocalStorageMock() {
  const store = new Map<string, string>();
  const mock = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
  Object.defineProperty(globalThis, 'localStorage', {
    value: mock,
    writable: true,
    configurable: true,
  });
  return store;
}

describe('question-stats-storage', () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // #150 把參考樣題的 id 改成來源代號，舊統計還掛在舊 id 上
  describe('改過 id 的題目', () => {
    const renames = (dataset.our_unique_items as { item_id: string; metadata?: { renamed_from?: { item_id: string } } }[])
      .filter((q) => q.metadata?.renamed_from)
      .map((q) => ({ oldId: q.metadata!.renamed_from!.item_id, newId: q.item_id }));
    const store = (items: Record<string, QuestionStat>) =>
      localStorage.setItem('ipas-question-stats', JSON.stringify({ version: 1, items }));

    it.each(renames)('$oldId 的統計算到 $newId，舊 id 不再出現', ({ oldId, newId }) => {
      const stat = { attempts: 3, correct: 1, lastTriedAt: 100 };
      store({ [oldId]: stat, other: { attempts: 1, correct: 1, lastTriedAt: 5 } });

      expect(loadStats()).toEqual({
        [newId]: stat,
        other: { attempts: 1, correct: 1, lastTriedAt: 5 },
      });
    });

    it('新舊 id 都有統計：次數相加，最後作答時間取較晚的，順序不影響結果', () => {
      const { oldId, newId } = renames[0];
      const merged = { attempts: 5, correct: 3, lastTriedAt: 200 };
      store({
        [oldId]: { attempts: 3, correct: 1, lastTriedAt: 100 },
        [newId]: { attempts: 2, correct: 2, lastTriedAt: 200 },
      });
      expect(loadStats()).toEqual({ [newId]: merged });

      store({
        [newId]: { attempts: 2, correct: 2, lastTriedAt: 200 },
        [oldId]: { attempts: 3, correct: 1, lastTriedAt: 100 },
      });
      expect(loadStats()).toEqual({ [newId]: merged });
    });

    it('讀幾次都一樣，再記一次也不會把舊統計算兩次', () => {
      const { oldId, newId } = renames[0];
      store({ [oldId]: { attempts: 3, correct: 1, lastTriedAt: 100 } });
      loadStats();
      expect(loadStats()[newId].attempts).toBe(3);

      recordAttempts([{ id: newId, isCorrect: true, at: 300 }]);

      const saved = JSON.parse(localStorage.getItem('ipas-question-stats')!);
      expect(saved.items).toEqual({ [newId]: { attempts: 4, correct: 2, lastTriedAt: 300 } });
      expect(loadStats()).toEqual(saved.items);
    });
  });

  describe('loadStats', () => {
    it('回 {} 當 localStorage 沒有 key', () => {
      expect(loadStats()).toEqual({});
    });

    it('回 {} 當 raw JSON 損壞，且會清掉壞資料', () => {
      localStorage.setItem('ipas-question-stats', '{not json');
      expect(loadStats()).toEqual({});
      expect(localStorage.getItem('ipas-question-stats')).toBeNull();
    });

    it('回 {} 當 schema version 不符', () => {
      localStorage.setItem(
        'ipas-question-stats',
        JSON.stringify({ version: 999, items: {} })
      );
      expect(loadStats()).toEqual({});
      expect(localStorage.getItem('ipas-question-stats')).toBeNull();
    });

    it('回 {} 當 items 不是 object', () => {
      localStorage.setItem(
        'ipas-question-stats',
        JSON.stringify({ version: 1, items: 'oops' })
      );
      expect(loadStats()).toEqual({});
    });

    it('拒絕 attempts < 1 / 非數字 / NaN（含 attempts=0 防 NaN%；Copilot PR #80）', () => {
      const bad = [
        { version: 1, items: { q1: { attempts: 0, correct: 0, lastTriedAt: 1 } } },
        { version: 1, items: { q1: { attempts: -1, correct: 0, lastTriedAt: 1 } } },
        { version: 1, items: { q1: { attempts: 'x', correct: 0, lastTriedAt: 1 } } },
        { version: 1, items: { q1: { attempts: NaN, correct: 0, lastTriedAt: 1 } } },
      ];
      for (const b of bad) {
        localStorage.setItem('ipas-question-stats', JSON.stringify(b));
        expect(loadStats()).toEqual({});
      }
    });

    it('拒絕 correct > attempts（資料不一致）', () => {
      localStorage.setItem(
        'ipas-question-stats',
        JSON.stringify({
          version: 1,
          items: { q1: { attempts: 1, correct: 5, lastTriedAt: 1 } },
        })
      );
      expect(loadStats()).toEqual({});
    });

    it('正常 payload 回 items dict', () => {
      const items = { q1: { attempts: 3, correct: 2, lastTriedAt: 1000 } };
      localStorage.setItem(
        'ipas-question-stats',
        JSON.stringify({ version: 1, items })
      );
      expect(loadStats()).toEqual(items);
    });

    it('shape 不符且 removeItem throw 也靜默回 {}', () => {
      // 走 isValidPayload=false → removeItem catch 路徑
      localStorage.setItem(
        'ipas-question-stats',
        JSON.stringify({ version: 999, items: {} })
      );
      vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
        throw new Error('boom');
      });
      expect(() => loadStats()).not.toThrow();
      expect(loadStats()).toEqual({});
    });

    it('JSON.parse throw 且 removeItem 也 throw → 靜默回 {}', () => {
      // 走 outer catch → 內層 removeItem catch 路徑
      localStorage.setItem('ipas-question-stats', 'definitely{not}json');
      vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
        throw new Error('boom');
      });
      expect(() => loadStats()).not.toThrow();
      expect(loadStats()).toEqual({});
    });
  });

  describe('recordAttempts', () => {
    it('空陣列為 no-op，不觸碰 storage', () => {
      const setSpy = vi.spyOn(localStorage, 'setItem');
      recordAttempts([]);
      expect(setSpy).not.toHaveBeenCalled();
    });

    it('新題目從 0 累積', () => {
      recordAttempts([
        { id: 'q1', isCorrect: true, at: 100 },
        { id: 'q2', isCorrect: false, at: 200 },
      ]);
      const s = loadStats();
      expect(s.q1).toEqual({ attempts: 1, correct: 1, lastTriedAt: 100 });
      expect(s.q2).toEqual({ attempts: 1, correct: 0, lastTriedAt: 200 });
    });

    it('既有題目 increment attempts/correct、lastTriedAt 取較新者', () => {
      recordAttempts([{ id: 'q1', isCorrect: true, at: 100 }]);
      recordAttempts([{ id: 'q1', isCorrect: false, at: 50 }]); // older 'at'
      recordAttempts([{ id: 'q1', isCorrect: true, at: 300 }]);
      const s = loadStats();
      expect(s.q1).toEqual({ attempts: 3, correct: 2, lastTriedAt: 300 });
    });

    it('correct=false 只 increment attempts、不 increment correct', () => {
      recordAttempts([{ id: 'q1', isCorrect: false, at: 100 }]);
      recordAttempts([{ id: 'q1', isCorrect: false, at: 200 }]);
      const s = loadStats();
      expect(s.q1).toEqual({ attempts: 2, correct: 0, lastTriedAt: 200 });
    });

    it('quota 例外靜默忽略，不 throw', () => {
      vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      expect(() => recordAttempts([{ id: 'q1', isCorrect: true, at: 1 }])).not.toThrow();
    });
  });

  describe('selectWeakQuestions', () => {
    const opts = { minAttempts: 3, maxRate: 0.5, limit: 10, isKnown: () => true };

    it('attempts < minAttempts 的題目被排除', () => {
      const stats = {
        q1: { attempts: 2, correct: 0, lastTriedAt: 1 }, // 答錯 2 次但不夠 3 次
        q2: { attempts: 3, correct: 0, lastTriedAt: 2 },
      };
      const weak = selectWeakQuestions(stats, opts);
      expect(weak.map((w) => w.id)).toEqual(['q2']);
    });

    it('rate >= maxRate 的題目被排除', () => {
      const stats = {
        q1: { attempts: 4, correct: 2, lastTriedAt: 1 }, // rate 0.5 = maxRate（排除：< 0.5 才算）
        q2: { attempts: 4, correct: 1, lastTriedAt: 2 }, // rate 0.25
      };
      const weak = selectWeakQuestions(stats, opts);
      expect(weak.map((w) => w.id)).toEqual(['q2']);
    });

    it('排序：rate 升冪 → attempts 降冪 → lastTriedAt 降冪', () => {
      const stats = {
        a: { attempts: 5, correct: 1, lastTriedAt: 100 }, // rate 0.20
        b: { attempts: 3, correct: 1, lastTriedAt: 200 }, // rate 0.33
        c: { attempts: 4, correct: 0, lastTriedAt: 300 }, // rate 0.00
        d: { attempts: 5, correct: 1, lastTriedAt: 50 },  // rate 0.20（同 a，attempts 同 → lastTriedAt 較舊）
      };
      const weak = selectWeakQuestions(stats, opts);
      // c (0%) → a (20%, attempts 5, newer) → d (20%, attempts 5, older) → b (33%)
      expect(weak.map((w) => w.id)).toEqual(['c', 'a', 'd', 'b']);
    });

    it('上限 limit 截斷', () => {
      const stats: Record<string, { attempts: number; correct: number; lastTriedAt: number }> = {};
      for (let i = 0; i < 15; i++) {
        stats[`q${i}`] = { attempts: 3, correct: 0, lastTriedAt: i };
      }
      const weak = selectWeakQuestions(stats, { ...opts, limit: 10 });
      expect(weak).toHaveLength(10);
    });

    it('空 stats 回空陣列', () => {
      expect(selectWeakQuestions({}, opts)).toEqual([]);
    });

    it('找不到題目的 id 先濾掉再取前 N 名：已刪除的題目不佔名額', () => {
      const stats = {
        gone1: { attempts: 9, correct: 0, lastTriedAt: 1 },
        gone2: { attempts: 9, correct: 0, lastTriedAt: 1 },
        kept: { attempts: 5, correct: 2, lastTriedAt: 1 },
      };

      const weak = selectWeakQuestions(stats, { ...opts, limit: 1, isKnown: (id) => id === 'kept' });

      expect(weak.map((w) => w.id)).toEqual(['kept']);
    });

    it('完全沒符合條件的 stats 回空陣列', () => {
      const stats = {
        q1: { attempts: 5, correct: 5, lastTriedAt: 1 }, // 100% 答對
      };
      expect(selectWeakQuestions(stats, opts)).toEqual([]);
    });
  });

  describe('clearStats', () => {
    it('清掉 storage', () => {
      recordAttempts([{ id: 'q1', isCorrect: true, at: 1 }]);
      expect(loadStats()).not.toEqual({});
      clearStats();
      expect(loadStats()).toEqual({});
    });

    it('removeItem throw 時靜默', () => {
      vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
        throw new Error('boom');
      });
      expect(() => clearStats()).not.toThrow();
    });
  });
});
