// useReview：useSyncExternalStore 訂閱星號與待複習錯題
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { useButtonNotice, useReview, useReviewNotice } from './useReview';
import {
  REVIEW_STORAGE_KEY,
  __resetReviewStoreForTesting,
  isStarred,
  setStar,
} from '../utils/review-storage';
import { installRealLocalStorage } from '../utils/__fixtures__/real-local-storage';

let store: Map<string, string>;

beforeEach(() => {
  store = installRealLocalStorage();
  __resetReviewStoreForTesting();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useReview', () => {
  it('同一個分頁的寫入：兩個使用它的元件都更新', () => {
    const a = renderHook(() => useReview());
    const b = renderHook(() => useReview());
    act(() => {
      setStar('x', true);
    });
    expect(isStarred(a.result.current, 'x')).toBe(true);
    expect(isStarred(b.result.current, 'x')).toBe(true);
  });

  it('另一個分頁的變動：storage 事件之後更新', () => {
    const { result } = renderHook(() => useReview());
    store.set(REVIEW_STORAGE_KEY, JSON.stringify({ v: 1, seeded: true, stars: { y: 1 }, wrong: {} }));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: REVIEW_STORAGE_KEY }));
    });
    expect(isStarred(result.current, 'y')).toBe(true);
  });

  it('另一個分頁 localStorage.clear()：key 是 null，一樣更新', () => {
    setStar('x', true);
    const { result } = renderHook(() => useReview());
    store.clear();
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
    });
    expect(isStarred(result.current, 'x')).toBe(false);
  });

  it('沒有變動時不重新 render：快照是同一個物件', () => {
    setStar('x', true);
    let renders = 0;
    function Probe() {
      useReview();
      renders += 1;
      return null;
    }
    render(<Probe />);
    const before = renders;
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: REVIEW_STORAGE_KEY }));
    });
    expect(renders).toBe(before);
  });
});

describe('useReviewNotice、useButtonNotice', () => {
  function Region() {
    return <p role="status">{useReviewNotice()}</p>;
  }
  function Star() {
    return <p role="status">{useButtonNotice('star', 'x')?.text}</p>;
  }

  it('按星號寫入失敗時，那顆星號上說沒有儲存；同一顆的下一次成功後收掉', () => {
    store.set('ipas-review-star-hint-seen', '1');
    render(<Star />);
    expect(screen.getByRole('status')).toHaveTextContent('');
    const set = localStorage.setItem;
    localStorage.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    act(() => {
      setStar('x', true);
    });
    expect(screen.getByRole('status')).toHaveTextContent(/沒有儲存/);
    localStorage.setItem = set;
    act(() => {
      setStar('x', true);
    });
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('新版資料：說只能讀取', () => {
    store.set(REVIEW_STORAGE_KEY, JSON.stringify({ v: 2 }));
    render(<Region />);
    expect(screen.getByRole('status')).toHaveTextContent(/只能讀取/);
  });
});
