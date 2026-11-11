// 題目來源選單上的星號題與待複習錯題：不加新按鈕，題數跟著名單與考科即時更新
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HomePage } from './HomePage';
import { allQuestions } from '../data/questions';
import { isQuestionScorable } from '../utils/scorable';
import {
  REVIEW_STORAGE_KEY,
  __resetReviewStoreForTesting,
  setStar,
} from '../utils/review-storage';
import { installRealLocalStorage } from '../utils/__fixtures__/real-local-storage';
import {
  __resetPracticePoolCacheForTesting,
  __setPracticePoolForTesting,
  loadPracticePool,
} from '../utils/practice-pool';
import { __resetReviewPoolForTesting } from '../utils/review-pool';
import { buildFixturePool } from '../utils/__fixtures__/practice-pool-fixture';

vi.mock('../utils/practice-pool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/practice-pool')>();
  return { ...actual, loadPracticePool: vi.fn(actual.loadPracticePool) };
});

let store: Map<string, string>;
const scorable = allQuestions.filter((q) => isQuestionScorable(q));
const s1 = scorable.filter((q) => q.subject === '考科1');
const s2 = scorable.filter((q) => q.subject === '考科2');

const put = (stars: string[], wrong: string[] = []) =>
  store.set(
    REVIEW_STORAGE_KEY,
    JSON.stringify({
      v: 1,
      seeded: true,
      stars: Object.fromEntries(stars.map((id) => [id, 1])),
      wrong: Object.fromEntries(wrong.map((id) => [id, { streak: 0, last: 1 }])),
    })
  );

const source = () => screen.getByLabelText('題目來源') as HTMLSelectElement;
const optionText = (value: string) =>
  within(source()).getAllByRole('option').find((o) => (o as HTMLOptionElement).value === value)?.textContent;
const hint = () => document.getElementById('source-hint')!;
const startButton = () => screen.getByRole('button', { name: /開始測驗/ });
const choose = (value: string) => fireEvent.change(source(), { target: { value } });

beforeEach(() => {
  store = installRealLocalStorage();
  __resetReviewStoreForTesting();
  __resetPracticePoolCacheForTesting();
  __resetReviewPoolForTesting();
  vi.mocked(loadPracticePool).mockClear();
  localStorage.setItem('practice-pool-disclosure-seen', '1');
});

afterEach(cleanup);

describe('題目來源：星號題與待複習錯題', () => {
  it('三個選項帶題數；兩者都有的題目只算一次', () => {
    put([s1[0].id, s1[1].id], [s1[1].id, s1[2].id, s1[3].id]);
    render(<HomePage onStartQuiz={() => {}} />);
    expect(optionText('review:starred')).toBe('星號題（2 題）');
    expect(optionText('review:wrong')).toBe('待複習錯題（3 題）');
    expect(optionText('review:both')).toBe('星號 + 待複習錯題（4 題）');
  });

  it('原有的選項一個不少、順序不變，這三個排在最後', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    const values = within(source()).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(values.slice(0, 2)).toEqual(['all', 'official']);
    expect(values.slice(-3)).toEqual(['review:starred', 'review:wrong', 'review:both']);
  });

  it('不多加首頁按鈕（所有者的限制）', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    expect(screen.queryByRole('button', { name: /星號|複習|錯題/ })).toBeNull();
  });

  it('題數跟著考科範圍與名單即時更新', () => {
    put([s1[0].id, s2[0].id]);
    render(<HomePage onStartQuiz={() => {}} />);
    expect(optionText('review:starred')).toBe('星號題（2 題）');
    fireEvent.change(screen.getByLabelText('考科範圍'), { target: { value: '考科1' } });
    expect(optionText('review:starred')).toBe('星號題（1 題）');
    act(() => {
      setStar(s1[1].id, true);
    });
    expect(optionText('review:starred')).toBe('星號題（2 題）');
  });

  it('有題目：說明可出幾題，開始時帶 questionSource', () => {
    put([s1[0].id]);
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    choose('review:starred');
    expect(hint()).toHaveTextContent('可出 1 題星號題，不會混入其他來源的題目。');
    expect(hint()).toHaveTextContent('題數設定是 20 題，但只有 1 題星號題，本次會出 1 題。');
    expect(startButton()).toBeEnabled();
    fireEvent.click(startButton());
    expect(onStartQuiz.mock.calls[0][0]).toMatchObject({ questionSource: 'review:starred' });
  });

  it('一題都沒有：說明怎麼把題目加進來，開始按鈕停用', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    choose('review:starred');
    expect(hint()).toHaveTextContent(/還沒有星號題/);
    expect(startButton()).toBeDisabled();
    choose('review:wrong');
    expect(hint()).toHaveTextContent(/還沒有待複習錯題/);
    expect(startButton()).toBeDisabled();
    choose('review:both');
    expect(hint()).toHaveTextContent(/還沒有星號題或待複習錯題/);
    expect(startButton()).toBeDisabled();
  });

  it('這個考科沒有、別的考科有：說的是換考科範圍', () => {
    put([s2[0].id]);
    render(<HomePage onStartQuiz={() => {}} />);
    fireEvent.change(screen.getByLabelText('考科範圍'), { target: { value: '考科1' } });
    choose('review:starred');
    expect(hint()).toHaveTextContent('這個考科範圍沒有星號題，可以把考科範圍改成全部。');
    expect(startButton()).toBeDisabled();
  });

  it('選了來源之後題目被清空：開始按鈕跟著停用', () => {
    put([s1[0].id]);
    render(<HomePage onStartQuiz={() => {}} />);
    choose('review:starred');
    expect(startButton()).toBeEnabled();
    act(() => {
      setStar(s1[0].id, false);
    });
    expect(startButton()).toBeDisabled();
  });

  it('練習池題：載入中不寫題數、不能開始；載完才算數', async () => {
    const fixture = buildFixturePool();
    let resolve!: (p: typeof fixture) => void;
    vi.mocked(loadPracticePool).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    put([fixture.items[0].id]);
    render(<HomePage onStartQuiz={() => {}} />);
    expect(optionText('review:starred')).toBe('星號題（載入中）');
    choose('review:starred');
    expect(hint()).toHaveTextContent(/載入/);
    expect(hint()).not.toHaveTextContent(/還沒有星號題/);
    expect(startButton()).toBeDisabled();
    await act(async () => {
      resolve(fixture);
    });
    await waitFor(() => expect(optionText('review:starred')).toBe('星號題（1 題）'));
    expect(startButton()).toBeEnabled();
  });

  it('練習池載入中：名單上已經有主題庫題時一樣不能開始，題數還不算數', () => {
    vi.mocked(loadPracticePool).mockImplementationOnce(() => new Promise(() => {}));
    put([s1[0].id, 'pool-only']);
    render(<HomePage onStartQuiz={() => {}} />);
    choose('review:starred');
    expect(startButton()).toBeDisabled();
    expect(hint()).toHaveTextContent(/載入/);
    expect(hint()).not.toHaveTextContent(/可出/);
  });

  it('練習池載入中：選的是別的來源時照常可以開始', () => {
    vi.mocked(loadPracticePool).mockImplementationOnce(() => new Promise(() => {}));
    put(['pool-only']);
    render(<HomePage onStartQuiz={() => {}} />);
    expect(optionText('review:starred')).toBe('星號題（載入中）');
    expect(startButton()).toBeEnabled();
    choose('official');
    expect(startButton()).toBeEnabled();
    expect(hint()).not.toHaveTextContent(/載入/);
  });

  it('練習池載入失敗：說明只寫給星號與待複習錯題，選別的來源時不提', async () => {
    vi.mocked(loadPracticePool).mockRejectedValueOnce(new Error('offline'));
    put(['pool-only']);
    render(<HomePage onStartQuiz={() => {}} />);
    choose('review:starred');
    await waitFor(() => expect(hint()).toHaveTextContent(/載入失敗/));
    choose('official');
    expect(hint()).not.toHaveTextContent(/載入失敗/);
  });

  it('練習池載入失敗的說明：網站可能剛更新，要重新載入頁面', async () => {
    vi.mocked(loadPracticePool).mockRejectedValueOnce(new Error('offline'));
    put(['pool-only']);
    render(<HomePage onStartQuiz={() => {}} />);
    choose('review:starred');
    await waitFor(() => expect(hint()).toHaveTextContent('題目載入失敗，網站可能剛更新。請重新載入頁面再開始。'));
  });

  it('練習池載入失敗：用主題庫的題數，並說明', async () => {
    vi.mocked(loadPracticePool).mockRejectedValueOnce(new Error('offline'));
    put([s1[0].id, 'pool-only']);
    render(<HomePage onStartQuiz={() => {}} />);
    choose('review:starred');
    await waitFor(() => expect(hint()).toHaveTextContent(/載入失敗/));
    expect(optionText('review:starred')).toBe('星號題（1 題）');
    expect(startButton()).toBeEnabled();
  });

  it('練習池載入失敗又一題都沒有：不說「還沒有星號題」，名單其實不是空的', async () => {
    vi.mocked(loadPracticePool).mockRejectedValueOnce(new Error('offline'));
    put(['pool-only']);
    render(<HomePage onStartQuiz={() => {}} />);
    choose('review:starred');
    await waitFor(() => expect(hint()).toHaveTextContent(/載入失敗/));
    expect(hint()).not.toHaveTextContent(/還沒有星號題/);
    expect(startButton()).toBeDisabled();
  });

  it('加強練習池已啟用：不說不會混入（名單上的練習池題會出），提示卡也說清楚', () => {
    localStorage.setItem('practice-pool-enabled', '1');
    __setPracticePoolForTesting(buildFixturePool());
    put([s1[0].id]);
    render(<HomePage onStartQuiz={() => {}} />);
    choose('review:starred');
    expect(hint()).not.toHaveTextContent('加強練習池在這個模式不會混入');
    expect(screen.getByTestId('practice-pool-tip')).toHaveTextContent('名單上的練習池題照出');
    expect(screen.getByTestId('practice-pool-tip')).not.toHaveTextContent('這一場不會混入練習池');
  });

  it('官方來源：題數說明不提加強練習池，說明卡說這個模式不混入', () => {
    localStorage.setItem('practice-pool-enabled', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    choose('official');
    expect(hint()).not.toHaveTextContent('加強練習池');
    expect(screen.getByTestId('practice-pool-tip')).toHaveTextContent('加強練習池不論有沒有啟用，這一場都不會混入');
  });
});

// 別的分頁改了星號或待複習錯題，題數說明的字跟著換。變短的話它下面的開始測驗往上移；使用者自己換來源才從頭量
describe('題數說明到使用者換選項之前不變矮', () => {
  it('別的分頁清掉星號：說明換成「還沒有星號題」，高度留著；換來源才從頭量', () => {
    put(s1.slice(0, 3).map((q) => q.id));
    // jsdom 沒有排版：照字數給高度
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { height: (this.textContent ?? '').length } as DOMRect;
    });
    try {
      render(<HomePage onStartQuiz={() => {}} />);
      choose('review:starred');
      const tall = (hint().textContent ?? '').length;
      expect(hint().style.minHeight).toBe(`${tall}px`);
      act(() => {
        put([]);
        window.dispatchEvent(new StorageEvent('storage', { key: REVIEW_STORAGE_KEY }));
      });
      expect(hint()).toHaveTextContent(/還沒有星號題/);
      expect((hint().textContent ?? '').length).toBeLessThan(tall);
      expect(hint().style.minHeight).toBe(`${tall}px`);
      choose('review:wrong');
      const now = (hint().textContent ?? '').length;
      expect(now).toBeLessThan(tall);
      expect(hint().style.minHeight).toBe(`${now}px`);
    } finally {
      rect.mockRestore();
    }
  });

  // 加強練習池的說明卡與頁首的徽章也一樣：別的分頁切換加強練習池時換字但不變矮，題目來源與下面的開始測驗不動
  describe('加強練習池的說明卡與頁首的徽章', () => {
    // jsdom 沒有排版。說明卡照看得到的列數給高度（標題、說明、按鈕、抽題分布的每一列；收起來的 <details> 只算 summary），
    // 其他照字數
    const shown = (el: Element): number =>
      el.matches('[data-testid="practice-pool-tip"]')
        ? [...el.querySelectorAll('h3, p, summary, button, li')].filter((e) => {
            const details = e.closest('details');
            return !details || details.open || e.tagName === 'SUMMARY';
          }).length * 20
        : (el.textContent ?? '').length;
    let rect: { mockRestore: () => void };
    beforeEach(() => {
      localStorage.setItem('practice-pool-ai-opt-in', '1');
      __setPracticePoolForTesting(buildFixturePool());
      rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return { height: shown(this) } as DOMRect;
      });
    });
    afterEach(() => rect.mockRestore());
    const otherTab = (value: string) =>
      act(() => {
        store.set('practice-pool-enabled', value);
        window.dispatchEvent(new StorageEvent('storage', { key: 'practice-pool-enabled' }));
      });
    const tip = () => screen.getByTestId('practice-pool-tip');
    const badges = () => document.querySelector('.stats-badges') as HTMLElement;
    const toggle = (name: '啟用加強練習池' | '停用加強練習池') => fireEvent.click(screen.getByRole('button', { name }));

    it('說明卡：別的分頁停用，抽題分布與說明換掉，高度留著；這個分頁自己按啟用、停用才從頭量', () => {
      localStorage.setItem('practice-pool-enabled', '1');
      render(<HomePage onStartQuiz={() => {}} />);
      const tall = shown(tip());
      expect(tip().style.minHeight).toBe(`${tall}px`);
      otherTab('0');
      expect(screen.getByRole('button', { name: '啟用加強練習池' })).toBeInTheDocument();
      expect(shown(tip()), '前提：停用之後說明卡比較短').toBeLessThan(tall);
      expect(tip().style.minHeight).toBe(`${tall}px`);
      otherTab('1');
      otherTab('0');
      expect(tip().style.minHeight).toBe(`${tall}px`);
      toggle('啟用加強練習池');
      toggle('停用加強練習池');
      const now = shown(tip());
      expect(tip().style.minHeight).toBe(`${now}px`);
    });

    it('頁首的徽章：別的分頁啟用，徽章的字換短，高度留著；這個分頁自己切換才從頭量', () => {
      localStorage.setItem('practice-pool-enabled', '0');
      render(<HomePage onStartQuiz={() => {}} />);
      const tall = shown(badges());
      expect(badges().style.minHeight).toBe(`${tall}px`);
      otherTab('1');
      expect(screen.getByRole('button', { name: '停用加強練習池' })).toBeInTheDocument();
      expect(shown(badges()), '前提：啟用之後徽章的字比較短').toBeLessThan(tall);
      expect(badges().style.minHeight).toBe(`${tall}px`);
      toggle('停用加強練習池');
      toggle('啟用加強練習池');
      expect(badges().style.minHeight).toBe(`${shown(badges())}px`);
    });

    it('頁首的徽章：在揭露對話框按同意（這個分頁自己啟用）也從頭量', () => {
      localStorage.removeItem('practice-pool-ai-opt-in');
      render(<HomePage onStartQuiz={() => {}} />);
      const tall = shown(badges());
      fireEvent.click(screen.getByRole('button', { name: '啟用加強練習池' }));
      fireEvent.click(screen.getByRole('button', { name: /我已了解/ }));
      expect(screen.getByRole('button', { name: '停用加強練習池' })).toBeInTheDocument();
      const now = shown(badges());
      expect(now, '前提：啟用之後徽章的字比較短').toBeLessThan(tall);
      expect(badges().style.minHeight).toBe(`${now}px`);
    });

    it('頁首的徽章：換成只出官方題目（切換的徽章收起來）、再換回全部題目，從頭量', () => {
      localStorage.setItem('practice-pool-enabled', '0');
      render(<HomePage onStartQuiz={() => {}} />);
      const all = shown(badges());
      expect(badges().style.minHeight).toBe(`${all}px`);
      choose('official');
      const official = shown(badges());
      expect(official, '前提：只出官方題目時徽章少一個').toBeLessThan(all);
      expect(badges().style.minHeight).toBe(`${official}px`);
      choose('all');
      expect(badges().style.minHeight).toBe(`${all}px`);
    });

    it('說明卡：使用者換題目來源、打開又收起抽題分布，從頭量', () => {
      localStorage.setItem('practice-pool-enabled', '1');
      render(<HomePage onStartQuiz={() => {}} />);
      const closed = shown(tip());
      const details = tip().querySelector('details')!;
      details.open = true;
      fireEvent(details, new Event('toggle'));
      expect(shown(tip()), '前提：打開之後比較高').toBeGreaterThan(closed);
      // 打開的時候頁面又畫了一次（例如改題數）：量到的是打開的高度
      fireEvent.change(document.getElementById('count')!, { target: { value: '5' } });
      expect(tip().style.minHeight, '前提：留著打開的高度').toBe(`${shown(tip())}px`);
      details.open = false;
      fireEvent(details, new Event('toggle'));
      expect(tip().style.minHeight).toBe(`${closed}px`);
      choose('official');
      const official = shown(tip());
      expect(official, '前提：只出官方題目時說明卡比較短').toBeLessThan(closed);
      expect(tip().style.minHeight).toBe(`${official}px`);
    });

    // 抽題分布那一列：有沒有這一列在首頁畫出來時、這個分頁自己切換或換題目來源時才定。別的分頁啟用時加一列的話，
    // 說明卡長高，下面的題目來源與開始測驗往下移
    describe('抽題分布那一列', () => {
      const row = () => tip().querySelector('details');
      const tipButton = () => within(tip()).getByRole('button');

      it('別的分頁啟用：不加那一列，說明與開關照啟用的畫，開關按了有用', () => {
        localStorage.setItem('practice-pool-enabled', '0');
        render(<HomePage onStartQuiz={() => {}} />);
        expect(row()).toBeNull();
        const before = shown(tip());
        otherTab('1');
        expect(tip()).toHaveTextContent('加強練習池已啟用');
        expect(tipButton()).toHaveTextContent('停用加強練習');
        expect(row(), '別的分頁啟用時加了抽題分布那一列').toBeNull();
        expect(shown(tip())).toBe(before);
        fireEvent.click(tipButton());
        expect(localStorage.getItem('practice-pool-enabled')).toBe('0');
        expect(tipButton()).toHaveTextContent('啟用 +');
      });

      it('別的分頁啟用之後：這個分頁自己停用再啟用、重新畫首頁、換題目來源再換回來，都照現在的狀態加上那一列', () => {
        localStorage.setItem('practice-pool-enabled', '0');
        render(<HomePage onStartQuiz={() => {}} />);
        otherTab('1');
        expect(row(), '前提').toBeNull();
        toggle('停用加強練習池');
        toggle('啟用加強練習池');
        expect(row()).not.toBeNull();
        cleanup();

        localStorage.setItem('practice-pool-enabled', '0');
        render(<HomePage onStartQuiz={() => {}} />);
        otherTab('1');
        cleanup();
        render(<HomePage onStartQuiz={() => {}} />);
        expect(row()).not.toBeNull();
        cleanup();

        localStorage.setItem('practice-pool-enabled', '0');
        render(<HomePage onStartQuiz={() => {}} />);
        otherTab('1');
        choose('official');
        choose('all');
        expect(row()).not.toBeNull();
      });

      it('別的分頁停用：那一列拿掉、高度留著；之後別的分頁再啟用也不加回來', () => {
        localStorage.setItem('practice-pool-enabled', '1');
        render(<HomePage onStartQuiz={() => {}} />);
        expect(row(), '前提').not.toBeNull();
        const tall = shown(tip());
        otherTab('0');
        expect(row()).toBeNull();
        expect(tip().style.minHeight).toBe(`${tall}px`);
        otherTab('1');
        expect(tip()).toHaveTextContent('加強練習池已啟用');
        expect(tipButton()).toHaveTextContent('停用加強練習');
        expect(row(), '別的分頁再啟用時把那一列加回來').toBeNull();
        expect(tip().style.minHeight).toBe(`${tall}px`);
        // 這個分頁自己按：照現在的狀態
        toggle('停用加強練習池');
        toggle('啟用加強練習池');
        expect(row()).not.toBeNull();
      });
    });
  });

  // 使用者自己換了會改說明的選項：從頭量，不留著上一個選項的高度（每一種都要，只看來源的話其他幾種留下空白）
  describe('使用者自己換選項：從頭量', () => {
    let rect: { mockRestore: () => void };
    beforeEach(() => {
      // jsdom 沒有排版：照字數給高度；練習池載入中的那一句當作很高
      rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const text = this.textContent ?? '';
        return { height: text.includes('正在載入') ? 500 : text.length } as DOMRect;
      });
    });
    afterEach(() => rect.mockRestore());
    const shrank = (tall: number) => {
      const now = (hint().textContent ?? '').length;
      expect(now, '前提：換了之後說明比較短').toBeLessThan(tall);
      expect(hint().style.minHeight).toBe(`${now}px`);
    };
    const subject = (value: string) => fireEvent.change(screen.getByLabelText('考科範圍'), { target: { value } });

    it('考科範圍', () => {
      put([...s1.slice(0, 3), ...s2.slice(0, 30)].map((q) => q.id));
      render(<HomePage onStartQuiz={() => {}} />);
      choose('review:starred');
      subject('考科1');
      expect(hint()).toHaveTextContent('本次會出 3 題');
      const tall = (hint().textContent ?? '').length;
      expect(hint().style.minHeight).toBe(`${tall}px`);
      subject('考科2');
      shrank(tall);
    });

    it('題數', () => {
      put(s1.slice(0, 3).map((q) => q.id));
      render(<HomePage onStartQuiz={() => {}} />);
      choose('review:starred');
      expect(hint()).toHaveTextContent('本次會出 3 題');
      const tall = (hint().textContent ?? '').length;
      fireEvent.change(screen.getByLabelText('題數'), { target: { value: '2' } });
      shrank(tall);
    });

    it('練習池載入完', async () => {
      const fixture = buildFixturePool();
      let resolve!: (p: typeof fixture) => void;
      vi.mocked(loadPracticePool).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
      put([fixture.items[0].id]);
      render(<HomePage onStartQuiz={() => {}} />);
      choose('review:starred');
      expect(hint()).toHaveTextContent('正在載入');
      expect(hint().style.minHeight).toBe('500px');
      await act(async () => {
        resolve(fixture);
      });
      await waitFor(() => expect(hint()).toHaveTextContent('可出 1 題'));
      shrank(500);
    });
  });
});

// 只出官方題目時加強練習池一題都不混入：首頁上的東西（說明卡、題數說明、頁首的徽章）都不隨它啟用與否改變。
// 別的分頁切換時這裡換字、長高的話，下面的題目來源與開始測驗會移動，指標下面的開始測驗跑掉
describe('只出官方題目：首頁不隨加強練習池啟用與否改變', () => {
  const page = () => document.querySelector('.home-page')!.outerHTML;
  const officialSources = () => {
    render(<HomePage onStartQuiz={() => {}} />);
    const values = within(source()).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    cleanup();
    return ['official', values.find((v) => v.startsWith('exam:'))!, values.find((v) => v.startsWith('sample:'))!];
  };
  const pool = (enabled: string | null, optedIn: string | null) => {
    for (const [key, value] of [
      ['practice-pool-enabled', enabled],
      ['practice-pool-ai-opt-in', optedIn],
    ] as const) {
      if (value === null) store.delete(key);
      else store.set(key, value);
    }
  };
  const otherTab = (enabled: string | null, optedIn: string | null) =>
    act(() => {
      pool(enabled, optedIn);
      window.dispatchEvent(new StorageEvent('storage', { key: 'practice-pool-enabled' }));
    });
  // 啟用、同意過但沒啟用、還沒同意
  const states = [
    ['1', '1'],
    ['0', '1'],
    [null, null],
  ] as const;

  it('三種官方來源都是：啟用、沒啟用、還沒同意，畫出來的首頁一樣', () => {
    for (const value of officialSources()) {
      const shown = states.map(([enabled, optedIn]) => {
        pool(enabled, optedIn);
        render(<HomePage onStartQuiz={() => {}} />);
        choose(value);
        const html = page();
        cleanup();
        return html;
      });
      expect(shown[1], `${value}：沒啟用`).toBe(shown[0]);
      expect(shown[2], `${value}：還沒同意`).toBe(shown[0]);
    }
  });

  it('別的分頁停用、啟用、撤回同意：首頁一個字都不換；說明卡說這個模式不混入', () => {
    __setPracticePoolForTesting(buildFixturePool());
    for (const value of officialSources()) {
      pool('1', '1');
      render(<HomePage onStartQuiz={() => {}} />);
      choose(value);
      const before = page();
      for (const [enabled, optedIn] of [['0', '1'], ['1', '1'], [null, null], ['1', '1']] as const) {
        otherTab(enabled, optedIn);
        expect(page(), `${value}：別的分頁改成 ${enabled}/${optedIn}`).toBe(before);
      }
      expect(screen.getByTestId('practice-pool-tip')).toHaveTextContent('加強練習池不論有沒有啟用，這一場都不會混入');
      // 首頁上切換加強練習池的按鈕（說明卡、頁首的徽章）在這個模式都不出現：按了也不影響這一場
      expect(screen.queryByRole('button', { name: /加強練習/ })).toBeNull();
      expect(within(screen.getByTestId('practice-pool-tip')).queryAllByRole('button')).toEqual([]);
      cleanup();
    }
  });

  it('換回全部題目：說明卡與徽章照加強練習池的狀態畫，可以切換', () => {
    pool('1', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    choose('official');
    choose('all');
    expect(screen.getByTestId('practice-pool-tip')).toHaveTextContent('下一場測驗會額外混入');
    fireEvent.click(screen.getByRole('button', { name: '停用加強練習池' }));
    expect(screen.getByRole('button', { name: '啟用加強練習池' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /啟用 \+\d+ 題加強練習/ })).toBeInTheDocument();
  });
});
