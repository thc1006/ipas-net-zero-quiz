// useQuestionStats 跨 tab 同步測試（Refs #64）
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAllQuestionStats } from './useQuestionStats';

const STATS_KEY = 'ipas-question-stats';

function installRealLocalStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    },
    writable: true,
    configurable: true,
  });
}

describe('useAllQuestionStats（Refs #64）', () => {
  beforeEach(() => {
    installRealLocalStorage();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('初始 mount 時讀取 localStorage 既有 stats', () => {
    localStorage.setItem(
      STATS_KEY,
      JSON.stringify({
        version: 1,
        items: { q1: { attempts: 3, correct: 2, lastTriedAt: 1 } },
      })
    );
    const { result } = renderHook(() => useAllQuestionStats());
    expect(result.current).toEqual({ q1: { attempts: 3, correct: 2, lastTriedAt: 1 } });
  });

  it('localStorage 為空時回 {}', () => {
    const { result } = renderHook(() => useAllQuestionStats());
    expect(result.current).toEqual({});
  });

  it('storage 事件（其他 tab 改 stats key）觸發 refresh', () => {
    const { result } = renderHook(() => useAllQuestionStats());
    expect(result.current).toEqual({});

    // 模擬另一 tab 寫入並 dispatch storage event
    localStorage.setItem(
      STATS_KEY,
      JSON.stringify({
        version: 1,
        items: { q2: { attempts: 5, correct: 3, lastTriedAt: 100 } },
      })
    );
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: STATS_KEY }));
    });
    expect(result.current).toEqual({ q2: { attempts: 5, correct: 3, lastTriedAt: 100 } });
  });

  it('storage 事件（key=null，另一 tab 呼 localStorage.clear）觸發 refresh', () => {
    localStorage.setItem(
      STATS_KEY,
      JSON.stringify({
        version: 1,
        items: { q1: { attempts: 3, correct: 2, lastTriedAt: 1 } },
      })
    );
    const { result } = renderHook(() => useAllQuestionStats());
    expect(result.current).toEqual({ q1: { attempts: 3, correct: 2, lastTriedAt: 1 } });

    // 另一 tab clear()，再 dispatch event with key=null
    localStorage.removeItem(STATS_KEY);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
    });
    expect(result.current).toEqual({});
  });

  it('storage 事件 key 為其他 key 時不 refresh', () => {
    const { result } = renderHook(() => useAllQuestionStats());
    const before = result.current;

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'unrelated-key' })
      );
    });
    // 還是同一個 reference（沒重抓）— 用 reference equality 確認
    expect(result.current).toBe(before);
  });

  it('unmount 時移除 listener（不 leak）', () => {
    const { unmount } = renderHook(() => useAllQuestionStats());
    unmount();
    // unmount 後 dispatch event 不應 throw（沒 listener）
    expect(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: STATS_KEY }));
    }).not.toThrow();
  });
});
