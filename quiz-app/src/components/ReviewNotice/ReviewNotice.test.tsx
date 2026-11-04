// 星號與待複習的提示：排在文件流裡。按鈕引起的排在那顆按鈕的位置，其他的排在主內容最上面，開頁就在；
// 螢幕閱讀器由一個開頁就在、看不見的 live region 念：每一次新的提示都念（字一樣也念），提示收掉時清空。
import { useLayoutEffect } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { ButtonNotice, ReviewAnnouncer, ReviewNotice, TopNoticeContext } from './ReviewNotice';
import { usePageNotices } from '../../hooks/useReview';
import {
  REVIEW_STORAGE_KEY,
  __resetReviewStoreForTesting,
  clearReviewNotices,
  recordReviewResults,
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

/** App.tsx 的排法：頁面的提示排在最上面或最後面，按鈕的排在按鈕那裡 */
function Page({ view = 'quiz' }: { view?: string }) {
  const { top, end, endEvent } = usePageNotices(view);
  return (
    <TopNoticeContext.Provider value={top}>
      <ReviewAnnouncer />
      <div data-testid="page">
        <ReviewNotice notice={top} />
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
      <div data-testid="end">
        <ReviewNotice notice={end} event={endEvent} end />
      </div>
    </TopNoticeContext.Provider>
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
        <Page />
        <Probe />
      </>
    );
    expect(firstCommit).toMatch(/新版網站寫入的/);
  });
});

describe('頁面的提示放在哪裡：換畫面時已經有的在最上面，之後才出現的不推動上面的東西', () => {
  const NEWER = /新版網站寫入的/;
  const otherTab = (raw: string) =>
    act(() => {
      store.set(REVIEW_STORAGE_KEY, raw);
      window.dispatchEvent(new StorageEvent('storage', { key: REVIEW_STORAGE_KEY }));
    });
  const v2 = JSON.stringify({ v: 2 });
  const v1 = JSON.stringify({ v: 1, seeded: true, stars: {}, wrong: {} });

  it('開頁就有的排在最上面', () => {
    store.set(REVIEW_STORAGE_KEY, v2);
    render(<Page />);
    expect(shown('page')).toMatch(NEWER);
    expect(shown('end')).toBe('');
  });

  it('別的分頁造成的（storage 事件）排在最後面，最上面不加；改回來時收掉', () => {
    render(<Page />);
    otherTab(v2);
    expect(shown('page')).toBe('');
    expect(shown('end')).toMatch(NEWER);
    expect(document.querySelector('.review-notice--end')).not.toBeNull();
    otherTab(v1);
    expect(shown('end')).toBe('');
  });

  it('按星號才發現的（沒收到 storage 事件）說在那顆星號下面，頁面上不加', () => {
    render(<Page />);
    store.set(REVIEW_STORAGE_KEY, v2);
    act(() => {
      setStar('a', true);
    });
    expect(shown('star-a')).toMatch(NEWER);
    expect(shown('page')).toBe('');
    expect(shown('end')).toBe('');
  });

  it('按星號才發現搬不走的壞資料：說在那顆星號下面', () => {
    render(<Page />);
    store.set(REVIEW_STORAGE_KEY, '{broken');
    const set = localStorage.setItem;
    localStorage.setItem = (k: string, v: string) => {
      if (k.startsWith(`${REVIEW_STORAGE_KEY}:corrupt`))
        throw new DOMException('quota', 'QuotaExceededError');
      set(k, v);
    };
    try {
      act(() => {
        setStar('a', true);
      });
    } finally {
      localStorage.setItem = set;
    }
    expect(shown('star-a')).toMatch(/不會儲存變更/);
    expect(shown('page')).toBe('');
    expect(shown('end')).toBe('');
  });

  it('最上面已經說了的現況，按鈕下面不再說一次；寫入失敗那一類照說', () => {
    store.set(REVIEW_STORAGE_KEY, v2);
    render(<Page />);
    act(() => {
      setStar('a', true);
    });
    expect(shown('star-a')).toBe('');
    expect(shown('page')).toMatch(NEWER);
    cleanup();

    // 最上面說結束測驗時沒有儲存，按星號又存不進去：這一次的結果照樣說在星號下面
    store.set(REVIEW_STORAGE_KEY, v1);
    const set = localStorage.setItem;
    localStorage.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    try {
      recordReviewResults([{ id: 'x', isCorrect: false, at: 1 }]);
      render(<Page />);
      act(() => {
        setStar('a', true);
      });
    } finally {
      localStorage.setItem = set;
    }
    expect(shown('page')).toMatch(/沒有儲存/);
    expect(shown('star-a')).toMatch(/沒有儲存/);
  });

  it('最後面的那一段：使用者接著按了會寫入的按鈕就收掉，結果說在那顆按鈕下面', () => {
    render(<Page />);
    otherTab(v2);
    expect(shown('end')).toMatch(NEWER);
    act(() => {
      setStar('c', true);
    });
    expect(shown('end')).toBe('');
    expect(shown('star-c')).toMatch(NEWER);
  });

  it('最上面的到換畫面之前不增不減：過時了也留著，換畫面才依現況重排', () => {
    store.set(REVIEW_STORAGE_KEY, v2);
    const { rerender } = render(<Page view="quiz" />);
    otherTab(v1);
    expect(shown('page')).toMatch(NEWER);
    expect(shown('end')).toBe('');
    rerender(<Page view="result" />);
    expect(shown('page')).toBe('');
    otherTab(v2);
    expect(shown('page')).toBe('');
    expect(shown('end')).toMatch(NEWER);
    // 換畫面時已經有的：排到最上面
    rerender(<Page view="home" />);
    expect(shown('page')).toMatch(NEWER);
    expect(shown('end')).toBe('');
  });
});

describe('提示在視窗外時', () => {
  type Callback = (entries: { isIntersecting: boolean; intersectionRatio: number }[]) => void;
  let observers: { callback: Callback; options: IntersectionObserverInit; disconnected: boolean }[];
  const seen = () => store.get('ipas-review-star-hint-seen') ?? null;
  const scroll = () => vi.mocked(Element.prototype.scrollIntoView);

  beforeEach(() => {
    observers = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        record: (typeof observers)[number];
        constructor(callback: Callback, options: IntersectionObserverInit) {
          this.record = { callback, options, disconnected: false };
          observers.push(this.record);
        }
        observe() {}
        disconnect() {
          this.record.disconnected = true;
        }
      }
    );
    scroll().mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('第一次加星號：不捲動；大半露出來才算看過，露出一點不算', () => {
    render(<Page />);
    act(() => {
      setStar('a', true);
    });
    expect(shown('star-a')).toBe(TIP);
    expect(scroll()).not.toHaveBeenCalled();
    expect(observers).toHaveLength(1);
    expect(observers[0].options.threshold).toBe(0.75);
    act(() => observers[0].callback([{ isIntersecting: true, intersectionRatio: 0.45 }]));
    expect(seen()).toBeNull();
    act(() => observers[0].callback([{ isIntersecting: true, intersectionRatio: 0.8 }]));
    expect(seen()).toBe('1');
    expect(observers[0].disconnected).toBe(true);
  });

  it('沒看到就收掉：不算看過，下次加星號再說一次', () => {
    render(<Page />);
    act(() => {
      setStar('a', true);
    });
    act(() => {
      setStar('a', false);
    });
    expect(observers[0].disconnected).toBe(true);
    expect(seen()).toBeNull();
    act(() => {
      setStar('c', true);
    });
    expect(shown('star-c')).toBe(TIP);
  });

  it('存不進去：每一次都捲到剛好看得到（block: nearest），不動焦點', () => {
    const set = localStorage.setItem;
    localStorage.setItem = (k: string, v: string) => {
      if (k === REVIEW_STORAGE_KEY) throw new DOMException('quota', 'QuotaExceededError');
      set(k, v);
    };
    try {
      render(<Page />);
      const before = document.activeElement;
      act(() => {
        setStar('a', true);
      });
      expect(scroll()).toHaveBeenCalledTimes(1);
      expect(scroll().mock.instances[0]).toBe(
        screen.getByTestId('star-a').querySelector('.review-notice')
      );
      expect(scroll()).toHaveBeenCalledWith({ block: 'nearest' });
      act(() => {
        setStar('a', true);
      });
      expect(scroll()).toHaveBeenCalledTimes(2);
      expect(document.activeElement).toBe(before);
    } finally {
      localStorage.setItem = set;
    }
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

  it('別的分頁造成、排在最後面的也念；收掉時清空', async () => {
    render(<Page />);
    act(() => {
      store.set(REVIEW_STORAGE_KEY, JSON.stringify({ v: 2 }));
      window.dispatchEvent(new StorageEvent('storage', { key: REVIEW_STORAGE_KEY }));
    });
    await waitFor(() => expect(live()).toHaveTextContent(/新版網站寫入的/));
    act(() => {
      store.delete(REVIEW_STORAGE_KEY);
      window.dispatchEvent(new StorageEvent('storage', { key: REVIEW_STORAGE_KEY }));
    });
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
