// 星號與待複習的提示：固定在視窗邊上，量出它蓋住多高，給捲動與頁尾的空白用。jsdom 沒有排版，位置由測試給。
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { ReviewNotice } from './ReviewNotice';
import { REVIEW_STORAGE_KEY, __resetReviewStoreForTesting, clearReviewNotices, setStar } from '../../utils/review-storage';
import { installRealLocalStorage } from '../../utils/__fixtures__/real-local-storage';

let store: Map<string, string>;
beforeAll(() => {
  store = installRealLocalStorage();
});

const root = document.documentElement;
const cssVar = (name: string) => root.style.getPropertyValue(name);

beforeEach(() => {
  store.clear();
  store.set(REVIEW_STORAGE_KEY, JSON.stringify({ v: 1, seeded: true, stars: {}, wrong: {} }));
  __resetReviewStoreForTesting();
  root.removeAttribute('style');
});

afterEach(() => {
  cleanup();
  root.removeAttribute('style');
});

// 換畫面與收掉提示可能在同一次 render（App 的 handleAbortQuiz、handleGoHome）
let goTo: (view: string) => void = () => undefined;
function Page() {
  const [view, setView] = useState('quiz');
  goTo = setView;
  return <ReviewNotice view={view} />;
}

describe('頁尾的空白', () => {
  it('收掉提示與換畫面在同一次 render：下一個畫面不留上一個畫面的空白', () => {
    render(<Page />);
    act(() => {
      setStar('gist-1', true);
    });
    expect(document.querySelector('.review-notice')).toHaveTextContent(/已加星號/);
    const shown = parseFloat(cssVar('--review-notice-reserve'));
    expect(shown).toBeGreaterThan(0);

    act(() => {
      clearReviewNotices();
      goTo('home');
    });
    expect(document.querySelector('.review-notice')).toBeEmptyDOMElement();
    expect(cssVar('--review-notice-cover')).toBe('0px');
    expect(cssVar('--review-notice-reserve')).toBe('0px');
  });
});
