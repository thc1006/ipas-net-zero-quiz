import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RemoveFromReview } from './RemoveFromReview';
import { useReview } from '../../hooks/useReview';
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

  it('別的分頁移出時不說是這裡移出的', () => {
    put({}, { q1: { streak: 0, last: 1 } });
    render(<RemoveFromReview questionId="q1" />);
    act(() => {
      put({}, {});
      window.dispatchEvent(new StorageEvent('storage', { key: REVIEW_STORAGE_KEY }));
    });
    expect(screen.queryByText('已移出待複習')).toBeNull();
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

// 有沒有這一列在畫出來時就定了（結果頁的錯題卡、題卡上答案揭曉的那一題）。別的分頁改了名單時那一列不消失、不變矮，
// 也不新加一列，不然它下面的東西全部移動
describe('別的分頁改了名單：那一列留著、高度不變，焦點留在那一列', () => {
  const otherTab = (wrong: object) =>
    act(() => {
      put({}, wrong);
      window.dispatchEvent(new StorageEvent('storage', { key: REVIEW_STORAGE_KEY }));
    });
  // jsdom 沒有排版：有按鈕的那一列 48，只有字的 20
  let rect: { mockRestore: () => void };
  beforeEach(() => {
    rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { height: this.querySelector('button') ? 48 : 20 } as DOMRect;
    });
  });
  afterEach(() => rect.mockRestore());
  const row = (container: HTMLElement) => container.querySelector('.review-remove') as HTMLElement;

  it('別的分頁移出：那一列留著、沒有按鈕，說已經不在待複習清單上，高度不變', () => {
    put({}, { q1: { streak: 1, last: 1 } });
    const { container } = render(<RemoveFromReview questionId="q1" />);
    const kept = row(container);
    expect(kept.style.minHeight).toBe('48px');
    otherTab({});
    expect(button()).toBeNull();
    expect(row(container)).toBe(kept);
    expect(kept).toHaveTextContent('已不在待複習清單上');
    expect(kept.style.minHeight).toBe('48px');
  });

  it('畫出來時不在清單上的：之後也不加一列', () => {
    put({}, {});
    const { container } = render(<RemoveFromReview questionId="q1" />);
    otherTab({ q1: { streak: 0, last: 1 } });
    expect(container).toBeEmptyDOMElement();
  });

  it('按下去移出：已移出待複習排在同一列裡，高度留在有按鈕時；按鈕沒拿到焦點（滑鼠點的）也把焦點移過去', () => {
    put({}, { q1: { streak: 0, last: 1 } });
    const { container } = render(<RemoveFromReview questionId="q1" />);
    const kept = row(container);
    fireEvent.click(button()!);
    expect(row(container)).toBe(kept);
    expect(kept).toHaveTextContent('已移出待複習');
    expect(kept.style.minHeight).toBe('48px');
    expect(screen.getByText('已移出待複習')).toHaveFocus();
  });

  it('按下去移出之後別的分頁加回來又移出：同一列、高度不變，焦點跟著換上來的那一個，不掉回 body', () => {
    put({}, { q1: { streak: 0, last: 1 } });
    const { container } = render(<RemoveFromReview questionId="q1" />);
    const kept = row(container);
    button()!.focus();
    fireEvent.click(button()!);
    expect(screen.getByText('已移出待複習')).toHaveFocus();
    otherTab({ q1: { streak: 0, last: 2 } });
    expect(row(container)).toBe(kept);
    expect(button()).toHaveFocus();
    expect(kept.style.minHeight).toBe('48px');
    otherTab({});
    expect(row(container)).toBe(kept);
    expect(kept.querySelector('[tabindex="-1"]')).toHaveFocus();
    expect(kept.style.minHeight).toBe('48px');
  });

  it('焦點在按鈕上時別的分頁移出：焦點移到那一列的字上；焦點不在那一列時不搶', () => {
    put({}, { q1: { streak: 0, last: 1 } });
    const { container } = render(
      <>
        <RemoveFromReview questionId="q1" />
        <button type="button">別的</button>
      </>
    );
    button()!.focus();
    otherTab({});
    expect(row(container).querySelector('[tabindex="-1"]')).toHaveFocus();
    expect(row(container)).toHaveTextContent('已不在待複習清單上');
    // 使用者走開之後，別的分頁再改也不把焦點拉回來
    screen.getByRole('button', { name: '別的' }).focus();
    otherTab({ q1: { streak: 0, last: 2 } });
    expect(screen.getByRole('button', { name: '別的' })).toHaveFocus();
    (document.activeElement as HTMLElement).blur();
    otherTab({});
    expect(document.activeElement).toBe(document.body);
  });

  it('按鈕被換掉的同時別的元素拿到焦點（同一次畫面更新裡的 autoFocus）：不搶回來', () => {
    put({}, { q1: { streak: 0, last: 1 } });
    // 名單空了才出現、自己拿焦點的輸入框，排在那一列前面：它先拿到焦點，那一列的 layout effect 才跑
    function Other() {
      const gone = wrongEntry(useReview(), 'q1') === undefined;
      return gone ? <input aria-label="別的" autoFocus /> : null;
    }
    render(
      <>
        <Other />
        <RemoveFromReview questionId="q1" />
      </>
    );
    button()!.focus();
    otherTab({});
    expect(screen.getByRole('textbox', { name: '別的' })).toHaveFocus();
  });

  it('存不進去的說明：別的分頁把同一題移出之後還在，焦點留在那一列', () => {
    put({}, { q1: { streak: 0, last: 1 } });
    const set = localStorage.setItem;
    localStorage.setItem = (k: string, v: string) => {
      if (k === REVIEW_STORAGE_KEY) throw new DOMException('quota', 'QuotaExceededError');
      set.call(localStorage, k, v);
    };
    try {
      const { container } = render(<RemoveFromReview questionId="q1" />);
      button()!.focus();
      fireEvent.click(button()!);
      expect(container.querySelector('.review-notice')).toHaveTextContent('這次變更沒有儲存');
      otherTab({});
      expect(row(container)).toHaveTextContent('已不在待複習清單上');
      expect(container.querySelector('.review-remove + .review-notice')).toHaveTextContent('這次變更沒有儲存');
      expect(document.activeElement).not.toBe(document.body);
      expect(row(container).contains(document.activeElement)).toBe(true);
    } finally {
      localStorage.setItem = set;
    }
  });
});
