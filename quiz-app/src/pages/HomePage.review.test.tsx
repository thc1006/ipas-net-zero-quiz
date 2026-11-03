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

  it('官方來源的說明一字不變', () => {
    localStorage.setItem('practice-pool-enabled', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    choose('official');
    expect(hint()).toHaveTextContent('加強練習池在這個模式不會混入');
    expect(screen.getByTestId('practice-pool-tip')).toHaveTextContent('這一場不會混入練習池');
  });
});
