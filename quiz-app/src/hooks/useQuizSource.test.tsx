// useQuizSource hook test — practice mode flag drives pool inclusion
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { useQuizSource } from './useQuizSource';

afterEach(() => {
  cleanup();
  localStorage.clear();
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

  it('loads pool when practice mode enabled', async () => {
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
    localStorage.setItem('practice-pool-enabled', '1');
    const { result } = renderHook(() => useQuizSource('考科1'));
    await waitFor(() => {
      expect(result.current.isPoolLoading).toBe(false);
    });
    // 不能斷言具體題數（依資料變動），但所有 poolItems 都應該真正是考科1
    for (const q of result.current.poolItems) {
      expect(q.qualityFlags?.includes('unmapped_subject')).not.toBe(true);
      expect(q.subject).toBe('考科1');
    }
  });
});
