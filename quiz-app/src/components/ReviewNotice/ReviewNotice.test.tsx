// 星號與待複習的提示：排在文件流裡。按鈕引起的排在那顆按鈕的位置，其他的排在主內容最上面，開頁就在；
// 螢幕閱讀器由一個開頁就在、看不見的 live region 念：每一次新的提示都念（字一樣也念），提示收掉時清空。
import { useLayoutEffect } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { ActionNotice, ButtonNotice, EndNotice, ReviewAnnouncer, ReviewNotice, TopNoticeContext } from './ReviewNotice';
import { END_RESOLVED_TEXT, NOTICE_TEXT, usePageNotices } from '../../hooks/useReview';
import {
  REVIEW_STORAGE_KEY,
  __resetReviewStoreForTesting,
  clearReviewNotices,
  getButtonNotice,
  getExternalChangeCount,
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
  const { top, end } = usePageNotices(view);
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
        <EndNotice end={end} />
      </div>
    </TopNoticeContext.Provider>
  );
}

const live = () => document.querySelector('.review-live')!;
/** 新版資料那一句的字數（jsdom 沒有排版，量高度的測試照字數給） */
const NOTICE_NEWER_LENGTH = () => NOTICE_TEXT.newer.length;
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

  describe('按鈕的提示屬於那張題卡：題卡換掉就收掉，回到那一題時不再出現', () => {
    /** QuizPage.tsx 的 <QuestionCard key={currentQuestion.id}>：換題時整張題卡換掉 */
    function Quiz({ id }: { id: string }) {
      return (
        <TopNoticeContext.Provider value={null}>
          <ReviewAnnouncer />
          <div key={id} data-testid="card">
            <ButtonNotice button="star" questionId={id} />
            <ButtonNotice button="remove" questionId={id} />
          </div>
        </TopNoticeContext.Provider>
      );
    }

    it('存不進去之後下一題、上一題：不再出現、不捲動、不再念', async () => {
      const set = localStorage.setItem;
      localStorage.setItem = (k: string, v: string) => {
        if (k === REVIEW_STORAGE_KEY) throw new DOMException('quota', 'QuotaExceededError');
        set(k, v);
      };
      try {
        const { rerender } = render(<Quiz id="q1" />);
        const said = recordLive();
        await act(async () => {
          setStar('q1', true);
        });
        await waitFor(() => expect(said.filter(Boolean)).toHaveLength(1));
        const scrolls = vi.mocked(Element.prototype.scrollIntoView).mock.calls.length;
        await act(async () => rerender(<Quiz id="q2" />));
        await act(async () => rerender(<Quiz id="q1" />));
        await new Promise((r) => setTimeout(r, 50));
        expect(shown('card')).toBe('');
        expect(vi.mocked(Element.prototype.scrollIntoView).mock.calls.length).toBe(scrolls);
        expect(said.filter(Boolean)).toHaveLength(1);
        expect(getButtonNotice('star', 'q1')).toBeNull();
      } finally {
        localStorage.setItem = set;
      }
    });

    it('第一次加星號的提示：換題就收掉，沒看到不算看過，回來不再出現；下次加星號再說', () => {
      // 一直沒有露出來（IntersectionObserver 從不回報）
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          observe() {}
          disconnect() {}
        }
      );
      onTestFinished(() => {
        vi.unstubAllGlobals();
      });
      const { rerender } = render(<Quiz id="q1" />);
      act(() => {
        setStar('q1', true);
      });
      expect(shown('card')).toBe(TIP);
      rerender(<Quiz id="q2" />);
      rerender(<Quiz id="q1" />);
      expect(shown('card')).toBe('');
      expect(store.get('ipas-review-star-hint-seen') ?? null).toBeNull();
      act(() => {
        setStar('q1', false);
      });
      act(() => {
        setStar('q1', true);
      });
      expect(shown('card')).toBe(TIP);
    });

    it('別張題卡的提示不受影響', () => {
      const { rerender } = render(
        <>
          <Quiz id="q1" />
          <div data-testid="other">
            <ButtonNotice button="star" questionId="c" />
          </div>
        </>
      );
      act(() => {
        setStar('c', true);
      });
      rerender(
        <>
          <Quiz id="q2" />
          <div data-testid="other">
            <ButtonNotice button="star" questionId="c" />
          </div>
        </>
      );
      expect(shown('other')).toBe(TIP);
    });
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

  it('別的分頁造成的（storage 事件）排在最後面，最上面不加；改回來時不收掉，改說已經恢復', () => {
    render(<Page />);
    otherTab(v2);
    expect(shown('page')).toBe('');
    expect(shown('end')).toMatch(NEWER);
    expect(document.querySelector('.review-notice--end')).not.toBeNull();
    otherTab(v1);
    expect(shown('end')).toBe(END_RESOLVED_TEXT);
    expect(document.querySelector('.review-notice--end')).toHaveClass('review-notice--resolved');
    // 又寫了新版資料：再說一次
    otherTab(v2);
    expect(shown('end')).toMatch(NEWER);
    expect(document.querySelector('.review-notice--end')).not.toHaveClass('review-notice--resolved');
  });

  it('最後面那一段到換畫面之前不變矮：改說已經恢復時保留它最高時的高度，換畫面才拿掉', () => {
    // jsdom 沒有排版：照字數給高度，新版資料的說明比恢復的那一句長
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        return { height: (this.textContent ?? '').length, width: 100 } as DOMRect;
      });
    try {
      const { rerender } = render(<Page view="quiz" />);
      otherTab(v2);
      const end = () => document.querySelector<HTMLElement>('.review-notice--end')!;
      const tall = NOTICE_NEWER_LENGTH();
      expect(end().style.minHeight).toBe(`${tall}px`);
      otherTab(v1);
      expect(shown('end')).toBe(END_RESOLVED_TEXT);
      expect(END_RESOLVED_TEXT.length).toBeLessThan(tall);
      expect(end().style.minHeight).toBe(`${tall}px`);
      rerender(<Page view="home" />);
      expect(document.querySelector('.review-notice--end')).toBeNull();
      // 新的畫面從頭量
      otherTab(v2);
      otherTab(v1);
      expect(end().style.minHeight).toBe(`${tall}px`);
      rerender(<Page view="result" />);
      store.set(REVIEW_STORAGE_KEY, v1);
      act(() => {
        reportReviewPoolFailure();
      });
      expect(document.querySelector('.review-notice--end')).toBeNull();
    } finally {
      rect.mockRestore();
    }
  });

  it('最後面已經有一段，別的分頁改回來之後現況正好是最上面那一句：最後面改說現況，不留著過時的那一句', () => {
    const { rerender } = render(<Page view="home" />);
    act(() => {
      reportReviewPoolFailure();
    });
    rerender(<Page view="quiz" />);
    expect(shown('page')).toMatch(/這一場先出主題庫/);
    otherTab(v2);
    expect(shown('end')).toMatch(NEWER);
    otherTab(v1);
    expect(shown('end')).toMatch(/這一場先出主題庫/);
  });

  it('最上面已經說了的，別的分頁又造成一次：最後面不重複', () => {
    store.set(REVIEW_STORAGE_KEY, v2);
    render(<Page />);
    otherTab(v1);
    otherTab(v2);
    expect(shown('page')).toMatch(NEWER);
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

  it('沒有人按、也不是別的分頁造成的（開始途中練習池載入失敗）：這個畫面不加、不念，排在下一個畫面的最上面', async () => {
    const { rerender } = render(<Page view="home" />);
    const said = recordLive();
    await act(async () => {
      reportReviewPoolFailure();
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(shown('page')).toBe('');
    expect(shown('end')).toBe('');
    expect(said).toEqual([]);
    await act(async () => rerender(<Page view="quiz" />));
    expect(shown('page')).toMatch(/這一場先出主題庫/);
    expect(shown('end')).toBe('');
    await waitFor(() => expect(said).toEqual([expect.stringMatching(/這一場先出主題庫/)]));
  });

  it('別的分頁的 storage 事件之後變的才排在最後面；別的 key 的事件不算', () => {
    render(<Page />);
    act(() => {
      reportReviewPoolFailure();
    });
    expect(shown('end')).toBe('');
    // 別的分頁寫了新版資料：新版資料比練習池載入失敗重要，頁面現在要說的換成它，而且是事件之後變的
    otherTab(v2);
    expect(shown('end')).toMatch(NEWER);
    // 不是這支 key 的事件不算
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'other' }));
    });
    expect(getExternalChangeCount()).toBe(1);
  });

  it('最後面的那一段：使用者接著按了會寫入的按鈕也不收掉，那一次的結果說在那顆按鈕下面', () => {
    render(<Page />);
    otherTab(v2);
    expect(shown('end')).toMatch(NEWER);
    act(() => {
      setStar('c', true);
    });
    expect(shown('end')).toMatch(NEWER);
    expect(shown('star-c')).toMatch(NEWER);
  });

  it('最後面說搬不走的壞資料，按星號時寫得進去了（別的分頁清出空間）：改說已經恢復', () => {
    render(<Page />);
    const set = localStorage.setItem;
    localStorage.setItem = (k: string, v: string) => {
      if (k.startsWith(`${REVIEW_STORAGE_KEY}:corrupt`)) throw new DOMException('quota', 'QuotaExceededError');
      set(k, v);
    };
    try {
      store.set(REVIEW_STORAGE_KEY, '{broken');
      act(() => {
        setStar('a', true);
      });
      // 別的分頁先寫了讀得懂的、又寫了一次讀不懂的：這邊收到事件，現況是「目前不會儲存」
      otherTab(v1);
      otherTab('{broken again');
      expect(shown('end')).toMatch(/不會儲存變更/);
    } finally {
      localStorage.setItem = set;
    }
    act(() => {
      setStar('a', true);
    });
    expect(shown('end')).toBe(END_RESOLVED_TEXT);
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

  it('被 sticky 頁首蓋住的部分不算看到：rootMargin 扣掉頁首的高度', () => {
    document.documentElement.style.setProperty('--app-header-height', '64px');
    try {
      render(<Page />);
      act(() => {
        setStar('a', true);
      });
      expect(observers[0].options.rootMargin).toBe('-64px 0px 0px 0px');
    } finally {
      document.documentElement.style.removeProperty('--app-header-height');
    }
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

  describe('存不進去：捲到看得到，剛按的按鈕不捲到頁首底下', () => {
    let restore: () => void;
    let boxes: Map<Element, { top: number; bottom: number }>;
    const scrollBy = () => vi.mocked(window.scrollBy);
    beforeEach(() => {
      const set = localStorage.setItem;
      localStorage.setItem = (k: string, v: string) => {
        if (k === REVIEW_STORAGE_KEY) throw new DOMException('quota', 'QuotaExceededError');
        set(k, v);
      };
      boxes = new Map();
      // jsdom 沒有排版：位置照測試給的，說明在畫出來時（layout effect）才有
      const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        const notice = this.classList.contains('review-notice') || this.classList.contains('action-notice');
        const box = notice ? boxes.get(NOTICE) : boxes.get(this);
        return { top: box?.top ?? 0, bottom: box?.bottom ?? 0, height: (box?.bottom ?? 0) - (box?.top ?? 0) } as DOMRect;
      });
      const height = vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(520);
      vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
      document.documentElement.style.setProperty('--app-header-height', '60px');
      restore = () => {
        localStorage.setItem = set;
        rect.mockRestore();
        height.mockRestore();
        scrollBy().mockRestore();
        document.documentElement.style.removeProperty('--app-header-height');
      };
    });
    afterEach(() => restore());
    const NOTICE = document.createElement('p');

    /** 題卡標頭那一列（兩顆按鈕），下面是那顆星號的提示 */
    function Card() {
      return (
        <div>
          <div className="row">
            <button type="button" data-testid="star">星號</button>
            <button type="button" data-testid="flag">回報</button>
          </div>
          <ButtonNotice button="star" questionId="a" />
        </div>
      );
    }
    const press = (notice: { top: number; bottom: number }, star: number, focused?: 'flag') => {
      boxes.set(NOTICE, notice);
      boxes.set(screen.getByTestId('star'), { top: star, bottom: star + 40 });
      boxes.set(screen.getByTestId('flag'), { top: star + 30, bottom: star + 70 });
      if (focused) screen.getByTestId(focused).focus();
      act(() => {
        setStar('a', true);
      });
    };

    it('放得下：捲到說明的底邊貼著視窗底邊，每一次都捲，不動焦點', () => {
      render(<Card />);
      const before = document.activeElement;
      press({ top: 500, bottom: 560 }, 440);
      expect(scrollBy()).toHaveBeenCalledTimes(1);
      expect(scrollBy()).toHaveBeenLastCalledWith(0, 40);
      press({ top: 500, bottom: 560 }, 440);
      expect(scrollBy()).toHaveBeenCalledTimes(2);
      expect(document.activeElement).toBe(before);
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });

    it('放不下：星號停在頁首下緣，說明露出放得下的部分', () => {
      render(<Card />);
      press({ top: 500, bottom: 700 }, 90);
      expect(scrollBy()).toHaveBeenLastCalledWith(0, 30);
    });

    it('小數取整數：說明那邊多捲不到 1px 貼齊視窗底邊，星號那邊少捲不到 1px 不碰到頁首', () => {
      render(<Card />);
      press({ top: 500, bottom: 560.3 }, 440);
      expect(scrollBy()).toHaveBeenLastCalledWith(0, 41);
      press({ top: 500, bottom: 700 }, 90.7);
      expect(scrollBy()).toHaveBeenLastCalledWith(0, 30);
    });

    it('第一次加星號的提示在視窗外：不捲（星號要留在指標底下）', () => {
      restore();
      boxes = new Map();
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        return (this.classList.contains('review-notice') ? { top: 500, bottom: 560 } : { top: 440, bottom: 480 }) as DOMRect;
      });
      vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(520);
      vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
      restore = () => vi.restoreAllMocks();
      render(<Card />);
      act(() => {
        setStar('a', true);
      });
      expect(document.querySelector('.review-notice')).toHaveTextContent(TIP);
      expect(scrollBy()).not.toHaveBeenCalled();
    });

    it('結果頁再測一次的說明（ActionNotice）也一樣：捲到看得到，按鈕不捲到頁首底下，每按一次都捲', () => {
      boxes.set(NOTICE, { top: 500, bottom: 560 });
      const { rerender } = render(
        <div>
          <div className="action-section">
            <button type="button" data-testid="star">再測一次</button>
          </div>
          <ActionNotice text="沒有題目" seq={1} />
        </div>
      );
      // 第一次畫的時候按鈕還沒有位置（jsdom，top 0 在頁首底下）：不捲
      expect(scrollBy()).not.toHaveBeenCalled();
      boxes.set(screen.getByTestId('star'), { top: 90, bottom: 130 });
      rerender(
        <div>
          <div className="action-section">
            <button type="button" data-testid="star">再測一次</button>
          </div>
          <ActionNotice text="沒有題目" seq={2} />
        </div>
      );
      expect(scrollBy()).toHaveBeenLastCalledWith(0, 30);
    });

    it('星號已經在頁首底下：不再往下捲', () => {
      render(<Card />);
      press({ top: 500, bottom: 700 }, 50);
      expect(scrollBy()).not.toHaveBeenCalled();
    });

    it('那一列裡有焦點的按鈕優先：它比較低，就以它為準', () => {
      render(<Card />);
      press({ top: 500, bottom: 700 }, 70, 'flag');
      // 回報的 top 是 100，頁首 60：最多捲 40
      expect(scrollBy()).toHaveBeenLastCalledWith(0, 40);
    });

    it('已經整段看得到：不捲', () => {
      render(<Card />);
      press({ top: 300, bottom: 360 }, 240);
      expect(scrollBy()).not.toHaveBeenCalled();
    });

    it('說明在頁首底下：往上捲到頁首下緣', () => {
      render(<Card />);
      press({ top: 20, bottom: 80 }, -20);
      expect(scrollBy()).toHaveBeenLastCalledWith(0, -40);
    });

    it('說明在頁首底下、位置有小數：往上多捲不到 1px，上緣不留在頁首底下', () => {
      render(<Card />);
      press({ top: 20.5, bottom: 80.5 }, -19.5);
      expect(scrollBy()).toHaveBeenLastCalledWith(0, -40);
      press({ top: 20.4, bottom: 80.4 }, -19.6);
      expect(scrollBy()).toHaveBeenLastCalledWith(0, -40);
    });
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
    const { rerender } = render(<Page view="home" />);
    const said = recordLive();
    await act(async () => {
      reportReviewPoolFailure();
      rerender(<Page view="quiz" />);
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

  it('別的分頁造成、排在最後面的也念；改說已經恢復時念恢復的那一句，再出現時再念', async () => {
    render(<Page />);
    const said = recordLive();
    const otherTabWrites = (raw: string | null) =>
      act(async () => {
        if (raw === null) store.delete(REVIEW_STORAGE_KEY);
        else store.set(REVIEW_STORAGE_KEY, raw);
        window.dispatchEvent(new StorageEvent('storage', { key: REVIEW_STORAGE_KEY }));
      });
    await otherTabWrites(JSON.stringify({ v: 2 }));
    await waitFor(() => expect(live()).toHaveTextContent(/新版網站寫入的/));
    await otherTabWrites(null);
    await waitFor(() => expect(live()).toHaveTextContent(END_RESOLVED_TEXT));
    await otherTabWrites(JSON.stringify({ v: 2 }));
    await waitFor(() => expect(live()).toHaveTextContent(/新版網站寫入的/));
    expect(said.filter(Boolean)).toEqual([
      expect.stringMatching(/新版網站寫入的/),
      END_RESOLVED_TEXT,
      expect.stringMatching(/新版網站寫入的/),
    ]);
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
