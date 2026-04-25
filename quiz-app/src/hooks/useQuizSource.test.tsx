// useQuizSource hook test — practice mode flag drives pool inclusion
import { afterEach, beforeAll, describe, expect, it, beforeEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { useQuizSource } from './useQuizSource';
import {
  __resetPracticePoolCacheForTesting,
  __setPracticePoolForTesting,
} from '../utils/practice-pool';
import { buildFixturePool } from '../utils/__fixtures__/practice-pool-fixture';


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

beforeEach(() => {
  __resetPracticePoolCacheForTesting();
});

describe('useQuizSource', () => {
  beforeEach(() => {
    // 重設 practice-pool-enabled flag
    localStorage.removeItem('practice-pool-enabled');
  });

  it('returns only mainBank when practice mode disabled', async () => {
    const { result } = renderHook(() => useQuizSource('all'));
    await waitFor(() => {
      expect(result.current.poolItems.length).toBe(0);
    });
    expect(result.current.combined.length).toBe(result.current.mainBank.length);
  });

  // 之前 it.skip 因 dynamic import flaky；改用 fixture 注入直接測 hook 整合層
  it('loads pool when practice mode enabled', async () => {
    __setPracticePoolForTesting(buildFixturePool());
    localStorage.setItem('practice-pool-enabled', '1');
    const { result } = renderHook(() => useQuizSource('all'));
    await waitFor(() => {
      expect(result.current.isPoolLoading).toBe(false);
      expect(result.current.poolItems.length).toBeGreaterThan(0);
    });
    expect(result.current.combined.length).toBe(
      result.current.mainBank.length + result.current.poolItems.length
    );
  });

  it('excludes unmapped_subject items from specific subject query', async () => {
    __setPracticePoolForTesting(buildFixturePool());
    localStorage.setItem('practice-pool-enabled', '1');
    const { result } = renderHook(() => useQuizSource('考科1'));
    await waitFor(() => {
      expect(result.current.isPoolLoading).toBe(false);
    });
    for (const q of result.current.poolItems) {
      expect(q.qualityFlags?.includes('unmapped_subject')).not.toBe(true);
      expect(q.subject).toBe('考科1');
    }
  });
});
