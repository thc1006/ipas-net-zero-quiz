// App 層：開站帶入舊統計、開始與再測一次走名單、寫入失敗時畫面上說沒有儲存
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { allQuestions } from './data/questions';
import { isQuestionScorable } from './utils/scorable';
import {
  REVIEW_STORAGE_KEY,
  __resetReviewStoreForTesting,
  getReviewSnapshot,
  setStar,
  wrongEntry,
} from './utils/review-storage';
import { installRealLocalStorage } from './utils/__fixtures__/real-local-storage';
import {
  __resetPracticePoolCacheForTesting,
  __setPracticePoolForTesting,
  loadPracticePool,
} from './utils/practice-pool';
import { __resetReviewPoolForTesting } from './utils/review-pool';
import { buildFixturePool } from './utils/__fixtures__/practice-pool-fixture';
import type { PracticePool } from './types/practicePool';
import type { QuizQuestion } from './types/quiz';

vi.mock('./utils/practice-pool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils/practice-pool')>();
  return { ...actual, loadPracticePool: vi.fn(actual.loadPracticePool) };
});

let store: Map<string, string>;
const scorable = allQuestions.filter((q) => isQuestionScorable(q));
const put = (stars: string[], wrong: Record<string, { streak: number; last: number }> = {}) =>
  store.set(
    REVIEW_STORAGE_KEY,
    JSON.stringify({ v: 1, seeded: true, stars: Object.fromEntries(stars.map((id) => [id, 1])), wrong })
  );

const source = () => screen.getByLabelText('題目來源') as HTMLSelectElement;
const optionText = (value: string) =>
  within(source()).getAllByRole('option').find((o) => (o as HTMLOptionElement).value === value)?.textContent;

/** 選一個來源開始，等題卡出現 */
async function startDrill(value: string) {
  fireEvent.change(source(), { target: { value } });
  fireEvent.click(screen.getByRole('checkbox', { name: /隨機出題順序/ }));
  fireEvent.click(screen.getByRole('button', { name: /開始測驗/ }));
  await waitFor(() => expect(document.querySelector('.question-card')).not.toBeNull());
}

function answer(q: QuizQuestion, right: boolean) {
  const key = right ? q.answer : q.options.find((o) => o.key !== q.answer)!.key;
  fireEvent.click(screen.getByRole('radio', { name: new RegExp(String.raw`^${key}:`) }));
}

const finish = () => fireEvent.click(screen.getByRole('button', { name: /完成測驗/ }));
const retry = () => screen.findByRole('button', { name: /再測一次/ });
const stem = () => document.querySelector('.question-stem p')?.textContent;
/** 畫面上每一個星號與待複習的提示的字（排在文件流裡，可能不只一個，沒有的時候一個元素都沒有） */
const notices = () => {
  const all = document.createElement('div');
  all.textContent = [...document.querySelectorAll('.review-notice')].map((n) => n.textContent).join('');
  return all;
};
/** 螢幕閱讀器念的：開頁就在、看不見的 live region */
const live = () => document.querySelector('.review-live')!;

beforeEach(() => {
  store = installRealLocalStorage();
  __resetReviewStoreForTesting();
  __resetPracticePoolCacheForTesting();
  __resetReviewPoolForTesting();
  vi.mocked(loadPracticePool).mockClear();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
  localStorage.setItem('practice-pool-disclosure-seen', '1');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('開站', () => {
  it('帶入舊統計裡答錯過的題目；題數馬上看得到', () => {
    const [q] = scorable;
    store.set(
      'ipas-question-stats',
      JSON.stringify({ version: 1, items: { [q.id]: { attempts: 2, correct: 1, lastTriedAt: 5 } } })
    );
    render(<App />);
    expect(optionText('review:wrong')).toBe('待複習錯題（1 題）');
    expect(wrongEntry(getReviewSnapshot(), q.id)).toEqual({ streak: 0, last: 5 });
  });

  it('壞資料開站時就搬走，並告訴使用者', async () => {
    store.set(REVIEW_STORAGE_KEY, '{broken');
    render(<App />);
    expect(store.get('ipas-review-v1:corrupt')).toBe('{broken');
    // 下一個 frame 才放字（announce.ts）
    await waitFor(() => expect(live()).toHaveTextContent('星號與待複習紀錄無法讀取，原始內容已另存，清單從空的開始。'));
    // 排在主內容最上面
    expect(document.querySelector('#main-content > .review-notice')).toHaveTextContent('原始內容已另存');
  });

  it('壞資料太大、搬不走：開站就說，不是等到按星號才知道', () => {
    store.set(REVIEW_STORAGE_KEY, '{broken');
    const set = localStorage.setItem;
    localStorage.setItem = (k: string, v: string) => {
      if (k.startsWith('ipas-review-v1:corrupt')) throw new DOMException('quota', 'QuotaExceededError');
      set(k, v);
    };
    render(<App />);
    expect(notices()).toHaveTextContent(/無法讀取.*不會儲存變更/);
    expect(store.get(REVIEW_STORAGE_KEY)).toBe('{broken');
  });
});

describe('測驗', () => {
  it('星號題：開始、答錯、結果頁，錯題進待複習', async () => {
    const [q] = scorable;
    put([q.id]);
    render(<App />);
    await startDrill('review:starred');
    answer(q, false);
    finish();
    await retry();
    expect(wrongEntry(getReviewSnapshot(), q.id)).toMatchObject({ streak: 0 });
  });

  it('連續兩場答對：第二場結束移出，再測一次沒有題目時留在結果頁並說明', async () => {
    const [q] = scorable;
    put([], { [q.id]: { streak: 0, last: 1 } });
    render(<App />);
    await startDrill('review:wrong');
    answer(q, true);
    finish();
    fireEvent.click(await retry());
    await waitFor(() => expect(document.querySelector('.question-card')).not.toBeNull());
    // 第一場答對過：這一場作答之前不顯示，答完才依這次的結果說
    expect(screen.queryByText('這場結束會移出')).toBeNull();
    answer(q, true);
    expect(screen.getByText('這場結束會移出')).toBeInTheDocument();
    finish();
    fireEvent.click(await retry());
    await waitFor(() =>
      expect(document.querySelector('.action-notice')).toHaveTextContent(/目前沒有待複習錯題可以再測一次/)
    );
    // 留在結果頁，返回首頁還按得到
    expect(screen.getByRole('button', { name: /返回首頁/ })).toBeInTheDocument();
    expect(document.querySelector('.question-card')).toBeNull();
    expect(wrongEntry(getReviewSnapshot(), q.id)).toBeUndefined();
  });

  it('再測一次依現在的名單重新抽題，不是上一場的清單', async () => {
    const [a, b, c] = scorable;
    put([a.id, b.id]);
    render(<App />);
    await startDrill('review:starred');
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /下一題/ }));
    finish();
    await retry();
    act(() => {
      setStar(a.id, false);
      setStar(b.id, false);
      setStar(c.id, true);
    });
    fireEvent.click(await retry());
    await waitFor(() => expect(stem()).toBe(c.stem));
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
  });

  it('再測一次成功之後，上一次沒題目的說明不留著', async () => {
    const [a, b] = scorable;
    put([a.id]);
    render(<App />);
    await startDrill('review:starred');
    finish();
    await retry();
    act(() => {
      setStar(a.id, false);
    });
    fireEvent.click(await retry());
    await waitFor(() => expect(document.querySelector('.action-notice')).toHaveTextContent(/目前沒有星號題/));
    act(() => {
      setStar(b.id, true);
    });
    fireEvent.click(await retry());
    await waitFor(() => expect(document.querySelector('.question-card')).not.toBeNull());
    finish();
    await retry();
    expect(document.querySelector('.action-notice')).toHaveTextContent('');
  });

  it('加強練習池啟用時：只出名單上的題，不混其他練習池題', async () => {
    const fixture = buildFixturePool();
    __setPracticePoolForTesting(fixture);
    store.set('practice-pool-enabled', '1');
    const [q] = scorable;
    put([q.id]);
    render(<App />);
    await startDrill('review:starred');
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    expect(stem()).toBe(q.stem);
  });

  it('名單上的練習池題：沒開加強練習也出得來', async () => {
    const fixture = buildFixturePool();
    __setPracticePoolForTesting(fixture);
    put([fixture.items[0].id]);
    render(<App />);
    await waitFor(() => expect(optionText('review:starred')).toBe('星號題（1 題）'));
    await startDrill('review:starred');
    expect(stem()).toBe(fixture.items[0].stem);
  });

  it('練習池在開始時才載入失敗：這一場照出主題庫的題目，畫面上說明', async () => {
    const [q] = scorable;
    put([q.id, 'pool-only']);
    __setPracticePoolForTesting(buildFixturePool());
    render(<App />);
    await waitFor(() => expect(optionText('review:starred')).toBe('星號題（1 題）'));
    vi.mocked(loadPracticePool).mockRejectedValueOnce(new Error('offline'));
    await startDrill('review:starred');
    expect(notices()).toHaveTextContent(/題目載入失敗.*這一場先出主題庫裡的題目/);
    // 「這一場」的提醒不跟到下一場
    fireEvent.click(screen.getByRole('button', { name: /結束並返回首頁/ }));
    fireEvent.click(screen.getByRole('button', { name: '結束並返回' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /隨機出題順序/ }));
    fireEvent.change(source(), { target: { value: 'all' } });
    fireEvent.click(screen.getByRole('button', { name: /開始測驗/ }));
    await waitFor(() => expect(document.querySelector('.question-card')).not.toBeNull());
    expect(notices()).toHaveTextContent('');
  });

  // 載入失敗在開始的途中回報，換到題目頁晚一個 render：中間那一次不能把它當成別的分頁造成的、排在首頁的最後面
  it('練習池在開始時才載入失敗：說明只排在題目頁的最上面，首頁的最後面一次都沒有出現，只念一次', async () => {
    const [q] = scorable;
    put([q.id, 'pool-only']);
    __setPracticePoolForTesting(buildFixturePool());
    render(<App />);
    await waitFor(() => expect(optionText('review:starred')).toBe('星號題（1 題）'));
    const said: string[] = [];
    const region = live();
    new MutationObserver(() => said.push(region.textContent ?? '')).observe(region, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    const ends: string[] = [];
    new MutationObserver(() => {
      const end = document.querySelector('.review-notice--end');
      if (end) ends.push(end.textContent ?? '');
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    vi.mocked(loadPracticePool).mockRejectedValueOnce(new Error('offline'));
    await startDrill('review:starred');
    await new Promise((r) => setTimeout(r, 100));
    expect(document.querySelector('#main-content > .review-notice:not(.review-notice--end)')).toHaveTextContent(
      /這一場先出主題庫/
    );
    expect(ends).toEqual([]);
    expect(said.filter(Boolean)).toEqual([expect.stringMatching(/這一場先出主題庫/)]);
  });

  it('回首頁就收掉練習池的提醒', async () => {
    const [q] = scorable;
    put([q.id, 'pool-only']);
    __setPracticePoolForTesting(buildFixturePool());
    render(<App />);
    await waitFor(() => expect(optionText('review:starred')).toBe('星號題（1 題）'));
    vi.mocked(loadPracticePool).mockRejectedValueOnce(new Error('offline'));
    await startDrill('review:starred');
    finish();
    fireEvent.click(await screen.findByRole('button', { name: /返回首頁/ }));
    await waitFor(() => expect(notices()).toHaveTextContent(''));
  });

  it('全部題目與官方題目的路徑照舊：不呼叫 startReviewQuiz 的名單判斷、不載入練習池', async () => {
    put(['pool-only']);
    render(<App />);
    await waitFor(() => expect(loadPracticePool).toHaveBeenCalledTimes(1));
    fireEvent.change(source(), { target: { value: 'official' } });
    fireEvent.click(screen.getByRole('button', { name: /開始測驗/ }));
    await waitFor(() => expect(document.querySelector('.question-card')).not.toBeNull());
    expect(loadPracticePool).toHaveBeenCalledTimes(1);
  });
});

describe('提示不跟到別的畫面', () => {
  it('換題時 live region 清空，最後面別的分頁造成的那一段還看得到也一樣', async () => {
    const [a, b] = scorable;
    put([a.id, b.id]);
    render(<App />);
    await startDrill('review:starred');
    await act(async () => {
      store.set(REVIEW_STORAGE_KEY, JSON.stringify({ v: 2, seeded: true, stars: {}, wrong: {} }));
      window.dispatchEvent(new StorageEvent('storage', { key: REVIEW_STORAGE_KEY }));
    });
    await waitFor(() => expect(live()).toHaveTextContent(/新版網站寫入的/));
    const first = stem();
    answer(scorable.find((q) => q.stem === first)!, true);
    fireEvent.click(screen.getByRole('button', { name: /下一題/ }));
    await waitFor(() => expect(stem()).not.toBe(first));
    expect(document.querySelector('.review-notice--end')).toHaveTextContent(/新版網站寫入的/);
    await new Promise((r) => setTimeout(r, 50));
    expect(live()).toBeEmptyDOMElement();
  });

  async function noQuestionsLeft() {
    const [a] = scorable;
    put([a.id]);
    render(<App />);
    await startDrill('review:starred');
    finish();
    await retry();
    act(() => {
      setStar(a.id, false);
    });
    fireEvent.click(await retry());
    await waitFor(() => expect(document.querySelector('.action-notice')).toHaveTextContent(/目前沒有星號題/));
  }

  it('再測一次沒有題目的說明：回首頁再開一場，結果頁不留著', async () => {
    await noQuestionsLeft();
    const [, b] = scorable;
    act(() => {
      setStar(b.id, true);
    });
    fireEvent.click(screen.getByRole('button', { name: /返回首頁/ }));
    await startDrill('review:starred');
    finish();
    await retry();
    expect(document.querySelector('.action-notice')).toHaveTextContent('');
  });

  it('App 記得的狀態也清掉：從設定頁回到有結果的畫面之前就收掉', async () => {
    await noQuestionsLeft();
    fireEvent.click(screen.getByLabelText(/開啟設定/));
    fireEvent.click(screen.getByRole('button', { name: /返回首頁/ }));
    const [, b] = scorable;
    act(() => {
      setStar(b.id, true);
    });
    await startDrill('review:starred');
    finish();
    await retry();
    expect(document.querySelector('.action-notice')).toHaveTextContent('');
  });

  it('寫入失敗的提示：換頁就收掉', async () => {
    const [q] = scorable;
    put([q.id]);
    render(<App />);
    await startDrill('review:starred');
    const set = localStorage.setItem;
    localStorage.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    fireEvent.click(screen.getByRole('button', { name: '加星號' }));
    expect(notices()).toHaveTextContent(/沒有儲存/);
    localStorage.setItem = set;
    fireEvent.click(screen.getByLabelText(/開啟設定/));
    expect(notices()).toHaveTextContent('');
  });

  it('寫入失敗的提示：放棄這一場回首頁也收掉', async () => {
    const [q] = scorable;
    put([q.id]);
    render(<App />);
    await startDrill('review:starred');
    const set = localStorage.setItem;
    localStorage.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    fireEvent.click(screen.getByRole('button', { name: '加星號' }));
    localStorage.setItem = set;
    fireEvent.click(screen.getByRole('button', { name: /結束並返回首頁/ }));
    fireEvent.click(screen.getByRole('button', { name: '結束並返回' }));
    expect(notices()).toHaveTextContent('');
  });

  it('開始失敗的訊息：換頁就收掉', async () => {
    store.set('practice-pool-enabled', '1');
    vi.mocked(loadPracticePool).mockRejectedValueOnce(new Error('offline'));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /開始測驗/ }));
    await waitFor(() => expect(document.querySelector('.start-failed')).not.toBeNull());
    fireEvent.click(screen.getByLabelText(/開啟設定/));
    expect(document.querySelector('.start-failed')).toBeNull();
  });
});

// 名單上有練習池題時，開始才載入練習池。等它的時候使用者走開了，晚到的結果不能換掉現在的畫面，
// 載不到也不能報到別的畫面（與加強練習池的路徑同一套規則）
describe('等練習池的時候使用者走開', () => {
  const fixture = buildFixturePool();
  let release: (pool: PracticePool) => void = () => {};
  let fail: (err: unknown) => void = () => {};
  const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

  /** 下一次載入練習池掛著，由測試放行 */
  function holdNextPoolLoad() {
    vi.mocked(loadPracticePool).mockImplementationOnce(
      () =>
        new Promise<PracticePool>((resolve, reject) => {
          release = resolve;
          fail = reject;
        })
    );
  }

  async function renderWithPoolStar() {
    put([fixture.items[0].id]);
    __setPracticePoolForTesting(fixture);
    render(<App />);
    await waitFor(() => expect(optionText('review:starred')).toBe('星號題（1 題）'));
  }

  function startHeld() {
    holdNextPoolLoad();
    fireEvent.change(source(), { target: { value: 'review:starred' } });
    fireEvent.click(screen.getByRole('button', { name: /開始測驗/ }));
  }

  it('去設定頁之後載入完成：留在設定頁', async () => {
    await renderWithPoolStar();
    startHeld();
    fireEvent.click(screen.getByLabelText(/開啟設定/));

    release(fixture);
    await settle();

    expect(screen.getByText(/^外觀$/)).toBeInTheDocument();
    expect(document.querySelector('.question-card')).toBeNull();
  });

  it('去設定頁之後載入失敗：設定頁不出現練習池載不到的提醒', async () => {
    await renderWithPoolStar();
    startHeld();
    fireEvent.click(screen.getByLabelText(/開啟設定/));

    fail(new TypeError('Failed to fetch dynamically imported module'));
    await settle();

    expect(notices()).toHaveTextContent('');
  });

  it('按了繼續測驗之後載入完成：續作的那一場不被換掉', async () => {
    const [a, b, c] = scorable;
    store.set(
      'ipas-quiz-in-progress-v2',
      JSON.stringify({
        version: 2,
        savedAt: 1,
        state: {
          isActive: true,
          questions: [a.id, b.id, c.id],
          currentIndex: 0,
          answers: [],
          startTime: 1,
          config: { mode: 'practice', subject: 'all', questionCount: 3, shuffleQuestions: false, showAnswerImmediately: true },
        },
      })
    );
    await renderWithPoolStar();
    startHeld();
    fireEvent.click(screen.getByRole('button', { name: /繼續測驗/ }));
    expect(await screen.findByText('1 / 3')).toBeInTheDocument();

    release(fixture);
    await settle();

    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(stem()).toBe(a.stem);
  });

  it('結果頁再測一次、等的時候別的分頁啟用了加強練習池：這一次取消，不說名單空了', async () => {
    await renderWithPoolStar();
    await startDrill('review:starred');
    finish();
    const again = await retry();
    holdNextPoolLoad();
    fireEvent.click(again);
    store.set('practice-pool-enabled', '1');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'practice-pool-enabled' }));
    });

    release(fixture);
    await settle();

    expect(document.querySelector('.action-notice')).toHaveTextContent('');
    expect(screen.getByRole('button', { name: /再測一次/ })).toBeInTheDocument();
  });
});

describe('結束測驗時存不進去的提示', () => {
  async function finishUnsaved() {
    const [q] = scorable;
    put([q.id]);
    render(<App />);
    await startDrill('review:starred');
    answer(q, false);
    const set = localStorage.setItem;
    localStorage.setItem = (k: string, v: string) => {
      if (k === REVIEW_STORAGE_KEY) throw new DOMException('quota', 'QuotaExceededError');
      set(k, v);
    };
    finish();
    await retry();
    expect(notices()).toHaveTextContent(/沒有儲存/);
    localStorage.setItem = set;
  }

  it('回首頁就收掉', async () => {
    await finishUnsaved();
    fireEvent.click(screen.getByRole('button', { name: /返回首頁/ }));
    expect(notices()).toHaveTextContent('');
  });

  it('再測一次，新的一場就收掉', async () => {
    await finishUnsaved();
    fireEvent.click(await retry());
    await waitFor(() => expect(document.querySelector('.question-card')).not.toBeNull());
    expect(notices()).toHaveTextContent('');
  });
});

describe('第一次加星號的提示不跟到結果頁', () => {
  it('作答中加星號，結束測驗後收掉', async () => {
    const [q] = scorable;
    store.set(REVIEW_STORAGE_KEY, JSON.stringify({ v: 1, seeded: true, stars: {}, wrong: {} }));
    render(<App />);
    fireEvent.click(screen.getByRole('checkbox', { name: /隨機出題順序/ }));
    fireEvent.change(screen.getByLabelText('題數'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /開始測驗/ }));
    await waitFor(() => expect(document.querySelector('.question-card')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '加星號' }));
    expect(notices()).toHaveTextContent(/已加星號/);
    answer(q, true);
    finish();
    await retry();
    expect(notices()).toHaveTextContent('');
  });
});

describe('找得到練習入口', () => {
  it('第一次加星號：status 區說去哪裡練，只說一次', async () => {
    const [a, b] = scorable;
    store.set(REVIEW_STORAGE_KEY, JSON.stringify({ v: 1, seeded: true, stars: {}, wrong: {} }));
    render(<App />);
    fireEvent.click(screen.getByRole('checkbox', { name: /隨機出題順序/ }));
    fireEvent.click(screen.getByRole('button', { name: /開始測驗/ }));
    await waitFor(() => expect(document.querySelector('.question-card')).not.toBeNull());
    expect(a.id).not.toBe(b.id);
    const star = screen.getByRole('button', { name: '加星號' });
    fireEvent.click(star);
    await waitFor(() => expect(live()).toHaveTextContent('已加星號，首頁「題目來源」選「星號題」可以反覆練習。'));
    // 排在題卡標頭那一列（星號所在）的正下方
    expect(document.querySelector('.question-header + .review-notice')).toHaveTextContent(
      '已加星號，首頁「題目來源」選「星號題」可以反覆練習。'
    );
    fireEvent.click(star);
    expect(notices()).toHaveTextContent('');
    fireEvent.click(star);
    expect(notices()).toHaveTextContent('');
  });
});

describe('寫入失敗', () => {
  it('按星號存不進去：畫面上有 role=status 的說明，星號維持原狀', async () => {
    const [q] = scorable;
    put([q.id]);
    render(<App />);
    await startDrill('review:starred');
    localStorage.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    const star = screen.getByRole('button', { name: '加星號' });
    fireEvent.click(star);
    expect(star).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(live()).toHaveTextContent(/沒有儲存/));
    expect(document.querySelector('.question-header + .review-notice')).toHaveTextContent(/沒有儲存/);
  });

  it('結果頁：星號與移出待複習存不進去，說在那張錯題卡裡、那顆按鈕那一列的下面', async () => {
    const [q] = scorable;
    put([], { [q.id]: { streak: 0, last: 1 } });
    render(<App />);
    await startDrill('review:wrong');
    answer(q, false);
    finish();
    await retry();
    localStorage.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    const underStar = () => document.querySelector('.wrong-item .wrong-stem-row + .review-notice');
    fireEvent.click(screen.getByRole('button', { name: '第 1 題加星號' }));
    expect(underStar()).toHaveTextContent(/沒有儲存/);
    fireEvent.click(screen.getByRole('button', { name: '第 1 題移出待複習' }));
    expect(document.querySelector('.wrong-item .review-remove + .review-notice')).toHaveTextContent(/沒有儲存/);
    // 星號下面那一句還在：別顆按鈕的寫入不收掉它
    expect(underStar()).toHaveTextContent(/沒有儲存/);
    expect(document.querySelector('#main-content > .review-notice')).toBeNull();
  });

  it('作答紀錄存不進去：結果頁上看得到', async () => {
    const [q] = scorable;
    put([q.id]);
    render(<App />);
    await startDrill('review:starred');
    answer(q, false);
    const set = localStorage.setItem;
    localStorage.setItem = (k: string, v: string) => {
      if (k === REVIEW_STORAGE_KEY) throw new DOMException('quota', 'QuotaExceededError');
      set(k, v);
    };
    finish();
    await retry();
    expect(notices()).toHaveTextContent(/沒有儲存/);
  });

  it('新版資料：開站就警告，不寫入', () => {
    const raw = JSON.stringify({ v: 2, stars: {} });
    store.set(REVIEW_STORAGE_KEY, raw);
    render(<App />);
    expect(notices()).toHaveTextContent(/只能讀取/);
    expect(store.get(REVIEW_STORAGE_KEY)).toBe(raw);
  });
});

describe('練習池載不到時，說的與出的一致', () => {
  const fixture = buildFixturePool();
  const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
  const actionNotice = () => document.querySelector('.action-notice')!;

  afterEach(() => {
    // mockReset 換回原本的實作：持續失敗的設定不跟到下一個測試
    vi.mocked(loadPracticePool).mockReset();
  });

  it('再測一次：名單上還有練習池題時，不說名單空了，也不說這一場先出主題庫的題目，說載入失敗', async () => {
    const [q] = scorable;
    put([q.id, fixture.items[0].id]);
    vi.mocked(loadPracticePool).mockRejectedValue(new TypeError('Failed to fetch dynamically imported module'));
    render(<App />);
    await waitFor(() => expect(optionText('review:starred')).toBe('星號題（1 題）'));
    await startDrill('review:starred');
    // 這一場真的開始了，出的是主題庫的題目：這句是對的
    expect(notices()).toHaveTextContent(/這一場先出主題庫裡的題目/);
    answer(q, false);
    finish();
    const again = await retry();
    // 取消主題庫那一題的星號：名單上只剩練習池題
    fireEvent.click(screen.getByRole('button', { name: '第 1 題加星號' }));
    fireEvent.click(again);
    await settle();

    expect(screen.getByRole('button', { name: /再測一次/ })).toBeInTheDocument();
    // 結果只在畫面上：叫人重新載入，就要說這份結果會不見（與開始失敗的訊息相同）
    expect(actionNotice()).toHaveTextContent(
      '題目載入失敗，網站可能剛更新。請重新載入頁面再開始。重新載入會清掉這份結果。'
    );
    expect(actionNotice()).not.toHaveTextContent(/目前沒有/);
    expect(notices()).not.toHaveTextContent(/這一場/);
  });

  it('首頁回報過載入失敗：選單寫幾題就出幾題，開始時不再載入練習池', async () => {
    const [q] = scorable;
    put([q.id, fixture.items[0].id]);
    vi.mocked(loadPracticePool).mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(fixture);
    render(<App />);
    await waitFor(() => expect(optionText('review:starred')).toBe('星號題（1 題）'));
    fireEvent.change(source(), { target: { value: 'review:starred' } });
    expect(document.getElementById('source-hint')).toHaveTextContent('重新載入之前只算主題庫裡的題目');
    await startDrill('review:starred');
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    expect(loadPracticePool).toHaveBeenCalledTimes(1);
  });

  it('首頁回報過載入失敗之後，回首頁再開也一樣：重新載入頁面之前都只算主題庫', async () => {
    const [q] = scorable;
    put([q.id, fixture.items[0].id]);
    vi.mocked(loadPracticePool).mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(fixture);
    render(<App />);
    await waitFor(() => expect(optionText('review:starred')).toBe('星號題（1 題）'));
    fireEvent.click(screen.getByLabelText(/開啟設定/));
    fireEvent.click(screen.getByRole('button', { name: '返回首頁' }));
    await settle();
    // 設定頁自己載入練習池成功了，選單還是只算主題庫，開始的也是
    expect(optionText('review:starred')).toBe('星號題（1 題）');
    await startDrill('review:starred');
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
  });
});

describe('改過 id 的題目', () => {
  // 2026-10-18：S1-p01-q004 改成 S_IPAS_SAMPLE_114_L11-q004
  it('改名前加的星號：首頁算得到、不用載入練習池，開始的就是那一題', async () => {
    put(['S1-p01-q004']);
    render(<App />);
    expect(optionText('review:starred')).toBe('星號題（1 題）');
    await startDrill('review:starred');
    expect(stem()).toBe(allQuestions.find((q) => q.id === 'S_IPAS_SAMPLE_114_L11-q004')!.stem);
    expect(loadPracticePool).not.toHaveBeenCalled();
  });
});
