import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RemoveFromReview } from './RemoveFromReview';
import {
  REVIEW_STORAGE_KEY,
  __resetReviewStoreForTesting,
  getReviewSnapshot,
  isStarred,
  recordReviewResults,
  wrongEntry,
} from '../../utils/review-storage';
import { installRealLocalStorage } from '../../utils/__fixtures__/real-local-storage';

let store: Map<string, string>;
const put = (stars: object, wrong: object) =>
  store.set(REVIEW_STORAGE_KEY, JSON.stringify({ v: 1, seeded: true, stars, wrong }));

beforeEach(() => {
  store = installRealLocalStorage();
  __resetReviewStoreForTesting();
});

afterEach(cleanup);

const button = () => screen.queryByRole('button', { name: '移出待複習' });

describe('RemoveFromReview', () => {
  it('不在待複習裡：什麼都不顯示', () => {
    put({}, {});
    const { container } = render(<RemoveFromReview questionId="q1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('連續答對 0 次：只有按鈕', () => {
    put({}, { q1: { streak: 0, last: 1 } });
    render(<RemoveFromReview questionId="q1" />);
    expect(button()).toBeInTheDocument();
    expect(screen.queryByText(/再答對/)).toBeNull();
  });

  it('連續答對 1 次：顯示再答對 1 次移出', () => {
    put({}, { q1: { streak: 1, last: 1 } });
    render(<RemoveFromReview questionId="q1" />);
    expect(screen.getByText('再答對 1 次移出')).toBeInTheDocument();
    expect(button()).toBeInTheDocument();
  });

  describe('剛答完：依這次的結果說，不是存著的狀態', () => {
    const progress = (streak: number, answeredCorrectly: boolean) => {
      put({}, { q1: { streak, last: 1 } });
      render(<RemoveFromReview questionId="q1" answeredCorrectly={answeredCorrectly} />);
    };

    it('答錯：要連續答對 2 次（不管之前答對過幾次）', () => {
      progress(1, false);
      expect(screen.getByText('要連續答對 2 次')).toBeInTheDocument();
      expect(screen.queryByText(/再答對/)).toBeNull();
      cleanup();
      progress(0, false);
      expect(screen.getByText('要連續答對 2 次')).toBeInTheDocument();
    });

    it('已經連續答對 1 次又答對：這場結束會移出', () => {
      progress(1, true);
      expect(screen.getByText('這場結束會移出')).toBeInTheDocument();
      expect(screen.queryByText(/再答對/)).toBeNull();
    });

    it('第一次答對：再答對 1 次移出', () => {
      progress(0, true);
      expect(screen.getByText('再答對 1 次移出')).toBeInTheDocument();
    });
  });

  it('按下去移出：星號不動，按鈕換成已移出，焦點跟過去（鍵盤使用者不會掉回頁首）', () => {
    put({ q1: 5 }, { q1: { streak: 0, last: 1 } });
    render(<RemoveFromReview questionId="q1" />);
    button()!.focus();
    fireEvent.click(button()!);
    expect(wrongEntry(getReviewSnapshot(), 'q1')).toBeUndefined();
    expect(isStarred(getReviewSnapshot(), 'q1')).toBe(true);
    expect(button()).toBeNull();
    expect(screen.getByText('已移出待複習')).toHaveFocus();
  });

  it('寫入失敗：按鈕留著，還沒移出', () => {
    put({}, { q1: { streak: 0, last: 1 } });
    render(<RemoveFromReview questionId="q1" />);
    localStorage.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    fireEvent.click(button()!);
    expect(button()).toBeInTheDocument();
    expect(screen.queryByText('已移出待複習')).toBeNull();
  });

  it('別的分頁移出時跟著消失，不說是這裡移出的', () => {
    put({}, { q1: { streak: 0, last: 1 } });
    const { container } = render(<RemoveFromReview questionId="q1" />);
    act(() => {
      put({}, {});
      window.dispatchEvent(new StorageEvent('storage', { key: REVIEW_STORAGE_KEY }));
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('移出之後又答錯回到待複習：按鈕回來', () => {
    put({}, { q1: { streak: 0, last: 1 } });
    render(<RemoveFromReview questionId="q1" />);
    fireEvent.click(button()!);
    act(() => {
      recordReviewResults([{ id: 'q1', isCorrect: false, at: Date.now() + 1000 }]);
    });
    expect(button()).toBeInTheDocument();
  });
});
