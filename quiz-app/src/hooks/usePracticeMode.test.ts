// usePracticeMode test — localStorage-backed enable/optIn state
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
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
});
