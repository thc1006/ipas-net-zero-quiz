// usePracticePool hook — error-path coverage
// 主路徑（success + filter）已透過 useQuizSource integration 測試覆蓋；
// 此檔專注於 loadPracticePool() reject 時 hook 應正確翻成 error state。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

vi.mock('../utils/practice-pool', async () => {
  const actual = await vi.importActual<typeof import('../utils/practice-pool')>(
    '../utils/practice-pool'
  );
  return {
    ...actual,
    loadPracticePool: vi.fn().mockRejectedValue(new Error('boom: pool fetch failed')),
  };
});

import { usePracticePool } from './usePracticePool';

afterEach(() => {
  cleanup();
});

describe('usePracticePool error path', () => {
  it('propagates loader rejection to error state and stops loading', async () => {
    const { result } = renderHook(() => usePracticePool());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch(/boom/);
    expect(result.current.pool).toBeNull();
    expect(result.current.items).toEqual([]);
    expect(result.current.totalCount).toBe(0);
  });
});
