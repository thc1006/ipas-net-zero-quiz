// 星號與待複習的提示：排在文件流裡。按鈕引起的排在那顆按鈕的位置，其他的排在主內容最上面，開頁就在；
// 螢幕閱讀器由一個開頁就在、看不見的 live region 念：每一次新的提示都念（字一樣也念），提示收掉時清空。
import { useLayoutEffect } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { ButtonNotice, ReviewAnnouncer, ReviewNotice } from './ReviewNotice';
import {
  REVIEW_STORAGE_KEY,
  __resetReviewStoreForTesting,
  clearReviewNotices,
  reportReviewPoolFailure,
  setStar,
} from '../../utils/review-storage';
import { installRealLocalStorage } from '../../utils/__fixtures__/real-local-storage';

const TIP = '已加星號，首頁「題目來源」選「星號題」可以反覆練習。';

let store: Map<string, string>;
beforeAll(() => {
  store = installRealLocalStorage();
});

beforeEach(() => {
  store.clear();
  store.set(REVIEW_STORAGE_KEY, JSON.stringify({ v: 1, seeded: true, stars: {}, wrong: {} }));
  __resetReviewStoreForTesting();
});

afterEach(cleanup);

function Page() {
  return (
    <>
      <ReviewAnnouncer />
      <div data-testid="page">
        <ReviewNotice />
      </div>
      <div data-testid="star-a">
        <ButtonNotice button="star" questionId="a" />
      </div>
      <div data-testid="star-c">
        <ButtonNotice button="star" questionId="c" />
      </div>
      <div data-testid="remove-a">
        <ButtonNotice button="remove" questionId="a" />
      </div>
    </>
  );
}

const live = () => document.querySelector('.review-live')!;
const shown = (testId: string) => screen.getByTestId(testId).textContent;

/** live region 每一次變動之後的字 */
function recordLive(): string[] {
  const said: string[] = [];
  const el = live();
  new MutationObserver(() => said.push(el.textContent ?? '')).observe(el, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  return said;
}

describe('看得到的提示', () => {
  it('沒有提示時一個元素都不留，不佔高度', () => {
    render(<Page />);
    expect(document.querySelectorAll('.review-notice')).toHaveLength(0);
  });

  it('按鈕引起的只排在那顆按鈕的位置，是一般內容，不是 live region', () => {
    render(<Page />);
    act(() => {
      setStar('a', true);
    });
    expect(shown('star-a')).toBe(TIP);
    expect(shown('star-c')).toBe('');
    expect(shown('remove-a')).toBe('');
    expect(shown('page')).toBe('');
    const note = screen.getByTestId('star-a').querySelector('.review-notice')!;
    expect(note.closest('[aria-live], [role="status"], [role="alert"], [tabindex]')).toBeNull();
  });

  it('按別顆星號時不收掉：收掉的話它下面那顆剛按的星號會往上移', () => {
    render(<Page />);
    act(() => {
      setStar('a', true);
    });
    act(() => {
      setStar('c', true);
    });
    expect(shown('star-a')).toBe(TIP);
    act(() => {
      setStar('a', false);
    });
    expect(shown('star-a')).toBe('');
  });

  it('換畫面、新的一場（clearReviewNotices）收掉', () => {
    render(<Page />);
    act(() => {
      setStar('a', true);
      reportReviewPoolFailure();
    });
    act(() => {
      clearReviewNotices();
    });
    expect(document.querySelectorAll('.review-notice')).toHaveLength(0);
  });

  it('新版資料：第一次畫出來就在，不是等 effect 才插進來', () => {
    store.set(REVIEW_STORAGE_KEY, JSON.stringify({ v: 2 }));
    let firstCommit: string | null = null;
    // 第一次 commit 之後、畫出來之前的 DOM
    function Probe() {
      useLayoutEffect(() => {
        firstCommit = document.querySelector('.review-notice')?.textContent ?? '';
      }, []);
      return null;
    }
    render(
      <>
        <ReviewNotice />
        <Probe />
      </>
    );
    expect(firstCommit).toMatch(/新版網站寫入的/);
  });
});

describe('螢幕閱讀器', () => {
  it('開頁就有一個看不見的 polite live region，空的', () => {
    render(<Page />);
    expect(live()).toHaveAttribute('role', 'status');
    expect(live()).toHaveAttribute('aria-live', 'polite');
    expect(live()).toHaveAttribute('aria-atomic', 'true');
    expect(live()).toHaveClass('sr-only');
    expect(live()).toBeEmptyDOMElement();
  });

  it('第一次加星號：同一個 live region 的字換一次，就是那一句', async () => {
    render(<Page />);
    const region = live();
    const said = recordLive();
    await act(async () => {
      setStar('a', true);
    });
    await waitFor(() => expect(said).toEqual([TIP]));
    expect(live()).toBe(region);
  });

  it('按鈕上的提示收掉時，不回頭再念頁面上那一句；新的一句才念', async () => {
    render(<Page />);
    const said = recordLive();
    await act(async () => {
      reportReviewPoolFailure();
    });
    await waitFor(() => expect(live()).toHaveTextContent('這一場先出主題庫'));
    await act(async () => {
      setStar('a', true);
    });
    await waitFor(() => expect(live()).toHaveTextContent(TIP));
    await act(async () => {
      setStar('a', false);
    });
    expect(said.filter(Boolean)).toEqual([expect.stringContaining('這一場先出主題庫'), TIP]);
    expect(live()).toBeEmptyDOMElement();
  });

  it('開頁就在的提示也念一次', async () => {
    store.set(REVIEW_STORAGE_KEY, JSON.stringify({ v: 2 }));
    await act(async () => {
      render(<Page />);
    });
    await waitFor(() => expect(live()).toHaveTextContent(/新版網站寫入的/));
  });

  describe('存不進去', () => {
    const NOT_SAVED = '這次變更沒有儲存。瀏覽器可能封鎖了網站資料，或儲存空間已滿。';
    let restore: () => void;
    beforeEach(() => {
      const set = localStorage.setItem;
      localStorage.setItem = (k: string, v: string) => {
        if (k === REVIEW_STORAGE_KEY) throw new DOMException('quota', 'QuotaExceededError');
        set(k, v);
      };
      restore = () => {
        localStorage.setItem = set;
      };
    });
    afterEach(() => restore());

    it('一樣的字再說一次也念：先清空，下一個 frame 再放字', async () => {
      render(<Page />);
      const said = recordLive();
      await act(async () => {
        setStar('a', true);
      });
      await waitFor(() => expect(said).toEqual([NOT_SAVED]));
      await act(async () => {
        setStar('a', true);
      });
      await waitFor(() => expect(said).toEqual([NOT_SAVED, '', NOT_SAVED]));
      await act(async () => {
        setStar('c', true);
      });
      await waitFor(() => expect(said).toEqual([NOT_SAVED, '', NOT_SAVED, '', NOT_SAVED]));
    });

    it('看得到的那一句收掉（換畫面、同一顆的下一次成功）時清空；別顆的收掉不動它', async () => {
      render(<Page />);
      await act(async () => {
        setStar('a', true);
      });
      await waitFor(() => expect(live()).toHaveTextContent(NOT_SAVED));
      await act(async () => {
        clearReviewNotices();
      });
      expect(live()).toBeEmptyDOMElement();

      await act(async () => {
        setStar('a', true);
        setStar('c', true);
      });
      await waitFor(() => expect(live()).toHaveTextContent(NOT_SAVED));
      restore();
      // a 的提示收掉，念的是 c 的：不清空
      await act(async () => {
        setStar('a', false);
      });
      expect(shown('star-a')).toBe('');
      expect(live()).toHaveTextContent(NOT_SAVED);
      await act(async () => {
        setStar('c', false);
      });
      expect(live()).toBeEmptyDOMElement();
    });
  });
});
