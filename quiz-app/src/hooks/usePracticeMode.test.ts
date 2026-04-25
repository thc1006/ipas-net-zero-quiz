// usePracticeMode test — localStorage-backed enable/optIn state
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { usePracticeMode } from './usePracticeMode';

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
