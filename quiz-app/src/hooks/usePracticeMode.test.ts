// usePracticeMode test — localStorage-backed enable/optIn state
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { usePracticeMode } from './usePracticeMode';


// 還原真實 localStorage 行為（test-setup.ts 把它 mock 成空函式）
function installRealLocalStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k: string): string | null => store.get(k) ?? null,
      setItem: (k: string, v: string): void => { store.set(k, v); },
      removeItem: (k: string): void => { store.delete(k); },
      clear: (): void => { store.clear(); },
      key: (i: number): string | null => Array.from(store.keys())[i] ?? null,
      get length(): number { return store.size; },
    },
    writable: true,
    configurable: true,
  });
}

beforeAll(() => { installRealLocalStorage(); });

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('usePracticeMode', () => {
  it('initial state from empty localStorage: disabled, not opted-in', () => {
    const { result } = renderHook(() => usePracticeMode());
    expect(result.current.enabled).toBe(false);
    expect(result.current.hasOptedIn).toBe(false);
  });

  it('reads existing localStorage on mount', () => {
    localStorage.setItem('practice-pool-enabled', '1');
    localStorage.setItem('practice-pool-ai-opt-in', '1');
    const { result } = renderHook(() => usePracticeMode());
    expect(result.current.enabled).toBe(true);
    expect(result.current.hasOptedIn).toBe(true);
  });

  it('enable() sets enabled and persists', () => {
    const { result } = renderHook(() => usePracticeMode());
    act(() => result.current.enable());
    expect(result.current.enabled).toBe(true);
    expect(localStorage.getItem('practice-pool-enabled')).toBe('1');
  });

  it('disable() unsets enabled', () => {
    localStorage.setItem('practice-pool-enabled', '1');
    const { result } = renderHook(() => usePracticeMode());
    act(() => result.current.disable());
    expect(result.current.enabled).toBe(false);
    expect(localStorage.getItem('practice-pool-enabled')).toBe('0');
  });

  it('acceptOptIn() sets both opted-in and enabled', () => {
    const { result } = renderHook(() => usePracticeMode());
    act(() => result.current.acceptOptIn());
    expect(result.current.hasOptedIn).toBe(true);
    expect(result.current.enabled).toBe(true);
  });

  it('resetOptIn() unsets opted-in', () => {
    localStorage.setItem('practice-pool-ai-opt-in', '1');
    const { result } = renderHook(() => usePracticeMode());
    act(() => result.current.resetOptIn());
    expect(result.current.hasOptedIn).toBe(false);
  });

  // App、HomePage、SettingsPage 各呼叫一次這個 hook。storage 事件不會在寫入的分頁觸發，靠它同步的話，
  // 在首頁按下去，App 還拿著舊值決定混不混練習池
  describe('同一個分頁裡的每一個 hook 看到同一個值', () => {
    const twoHooks = () => [
      renderHook(() => usePracticeMode()).result,
      renderHook(() => usePracticeMode()).result,
    ];

    it('一個 hook 啟用、停用，另一個立刻跟著變', () => {
      localStorage.setItem('practice-pool-ai-opt-in', '1');
      const [a, b] = twoHooks();
      act(() => a.current.enable());
      expect(b.current.enabled).toBe(true);
      act(() => b.current.disable());
      expect(a.current.enabled).toBe(false);
    });

    it('一個 hook 確認揭露聲明、重置，另一個立刻跟著變', () => {
      const [a, b] = twoHooks();
      act(() => a.current.acceptOptIn());
      expect(b.current).toMatchObject({ hasOptedIn: true, enabled: true });
      act(() => b.current.resetOptIn());
      expect(a.current.hasOptedIn).toBe(false);
    });

    it('別的分頁改了 localStorage：每一個 hook 都跟著變', () => {
      const [a, b] = twoHooks();
      localStorage.setItem('practice-pool-enabled', '1');
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key: 'practice-pool-enabled' }));
      });
      for (const hook of [a, b]) expect(hook.current.enabled).toBe(true);
      localStorage.setItem('practice-pool-ai-opt-in', '1');
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key: 'practice-pool-ai-opt-in' }));
      });
      for (const hook of [a, b]) expect(hook.current.hasOptedIn).toBe(true);
    });

    it('unmount 之後不留訂閱', () => {
      const add = vi.spyOn(window, 'addEventListener');
      const remove = vi.spyOn(window, 'removeEventListener');
      const handlers = (spy: typeof add | typeof remove) =>
        new Set(spy.mock.calls.filter(([type]) => type === 'storage').map(([, handler]) => handler));
      const { result, unmount } = renderHook(() => usePracticeMode());
      const { enable } = result.current;
      unmount();
      expect(handlers(add).size).toBe(2); // 兩個值各訂閱一次
      expect(handlers(remove)).toEqual(handlers(add));
      // 只剩 write 自己核對的那一次讀取：訂閱者還在的話，通知時會再讀一次快照
      const getItem = vi.spyOn(localStorage, 'getItem');
      act(() => enable());
      expect(getItem).toHaveBeenCalledOnce();
      vi.restoreAllMocks();
    });

    it('別的分頁 localStorage.clear()（key 是 null）：每一個 hook 都回到預設值', () => {
      localStorage.setItem('practice-pool-enabled', '1');
      localStorage.setItem('practice-pool-ai-opt-in', '1');
      const [a, b] = twoHooks();
      localStorage.clear();
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key: null }));
      });
      for (const hook of [a, b]) {
        expect(hook.current).toMatchObject({ enabled: false, hasOptedIn: false });
      }
    });

    it('localStorage.clear() 也清掉寫不進去、留在記憶體的值', () => {
      const [a, b] = twoHooks();
      const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      act(() => a.current.acceptOptIn());
      setItem.mockRestore();
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key: null }));
      });
      for (const hook of [a, b]) {
        expect(hook.current).toMatchObject({ enabled: false, hasOptedIn: false });
      }
    });

    // localStorage 裡還是 '1'：記憶體裡的 false 要蓋過它，否則畫面與抽題都還是啟用
    it('寫不進 localStorage 時停用：下一場不混入', () => {
      localStorage.setItem('practice-pool-enabled', '1');
      const [a, b] = twoHooks();
      const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      act(() => a.current.disable());
      setItem.mockRestore();
      expect(localStorage.getItem('practice-pool-enabled')).toBe('1');
      for (const hook of [a, b]) expect(hook.current.enabled).toBe(false);
      // 寫得進去之後以 localStorage 為準：不留記憶體裡的值給下一個測試
      act(() => a.current.disable());
      expect(localStorage.getItem('practice-pool-enabled')).toBe('0');
    });

    it('寫不進 localStorage（私密模式）：這次造訪仍照使用者的選擇走，兩個 hook 一致', () => {
      const [a, b] = twoHooks();
      const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      act(() => a.current.acceptOptIn());
      setItem.mockRestore();
      expect(localStorage.getItem('practice-pool-enabled')).toBeNull();
      for (const hook of [a, b]) expect(hook.current).toMatchObject({ enabled: true, hasOptedIn: true });
      // 別的 key 的事件不動記憶體裡的值
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key: 'ipas-question-stats' }));
      });
      for (const hook of [a, b]) expect(hook.current).toMatchObject({ enabled: true, hasOptedIn: true });
      // 別的分頁寫進去的值比這份記憶體裡的新，只換那一個 key
      localStorage.setItem('practice-pool-enabled', '0');
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key: 'practice-pool-enabled' }));
      });
      for (const hook of [a, b]) expect(hook.current).toMatchObject({ enabled: false, hasOptedIn: true });
      // 寫得進去之後以 localStorage 為準：不留記憶體裡的值給下一個測試
      act(() => a.current.resetOptIn());
      expect(localStorage.getItem('practice-pool-ai-opt-in')).toBe('0');
      for (const hook of [a, b]) expect(hook.current.hasOptedIn).toBe(false);
    });
  });
});
