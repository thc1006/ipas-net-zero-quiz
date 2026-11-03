// 設定頁的星號與待複習錯題：匯出、匯入（先看題數、確認才合併）、清除（確認 dialog）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReviewBackup } from './ReviewBackup';
import { REVIEW_STORAGE_KEY, __resetReviewStoreForTesting } from '../../utils/review-storage';
import { REVIEW_IMPORT_MAX_BYTES } from '../../utils/review-transfer';
import { installRealLocalStorage } from '../../utils/__fixtures__/real-local-storage';
import {
  __resetPracticePoolCacheForTesting,
  __setPracticePoolForTesting,
  loadPracticePool,
} from '../../utils/practice-pool';
import { buildFixturePool } from '../../utils/__fixtures__/practice-pool-fixture';
import { allQuestions } from '../../data/questions';

vi.mock('../../utils/practice-pool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/practice-pool')>();
  return { ...actual, loadPracticePool: vi.fn(actual.loadPracticePool) };
});

let store: Map<string, string>;
const put = (stars: object, wrong: object = {}) =>
  store.set(REVIEW_STORAGE_KEY, JSON.stringify({ v: 1, seeded: true, stars, wrong }));
const saved = () => JSON.parse(store.get(REVIEW_STORAGE_KEY)!);
const status = () => document.querySelector('.review-backup__status')!;
const backup = (stars: object, wrong: object = {}) =>
  JSON.stringify({ app: 'ipas-net-zero-quiz', schema: 1, exportedAt: '2026-11-01T00:00:00.000Z', stars, wrong });

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
function choose(text: string, name = 'backup.json') {
  fireEvent.change(fileInput(), { target: { files: [new File([text], name, { type: 'application/json' })] } });
}

beforeEach(() => {
  store = installRealLocalStorage();
  __resetReviewStoreForTesting();
  __setPracticePoolForTesting(buildFixturePool());
});

afterEach(() => {
  __resetPracticePoolCacheForTesting();
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('匯出', () => {
  it('Blob 加 <a download>：檔名帶日期，內容是約定的形狀', async () => {
    put({ a: 1 }, { b: { streak: 1, last: 2 } });
    let blob: Blob | undefined;
    const createObjectURL = vi.fn((b: Blob) => {
      blob = b;
      return 'blob:x';
    });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this);
    });
    render(<ReviewBackup />);
    fireEvent.click(screen.getByRole('button', { name: /匯出備份/ }));
    expect(clicks).toHaveLength(1);
    expect(clicks[0].download).toMatch(/^ipas-review-\d{4}-\d{2}-\d{2}\.json$/);
    expect(clicks[0].href).toBe('blob:x');
    const out = JSON.parse(await blob!.text());
    expect(out).toMatchObject({ app: 'ipas-net-zero-quiz', schema: 1, stars: { a: 1 }, wrong: { b: { streak: 1, last: 2 } } });
    expect(status()).toHaveTextContent('已匯出：星號 1 題、待複習錯題 1 題。');
  });

  it('匯出時重讀：畫面沒有更新時，另一個分頁剛加的星號也要在裡面', async () => {
    put({ a: 1 });
    let blob: Blob | undefined;
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: (b: Blob) => {
        blob = b;
        return 'blob:x';
      },
      revokeObjectURL: vi.fn(),
    }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<ReviewBackup />);
    put({ a: 1, later: 2 }); // storage 事件還沒到
    fireEvent.click(screen.getByRole('button', { name: /匯出備份/ }));
    expect(Object.keys(JSON.parse(await blob!.text()).stars)).toEqual(['a', 'later']);
  });

  it('物件網址等下載開始之後才 revoke：立刻 revoke 會讓 Safari 下載失敗；之後一定要 revoke', () => {
    vi.useFakeTimers();
    try {
      const revokeObjectURL = vi.fn();
      vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL }));
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      render(<ReviewBackup />);
      fireEvent.click(screen.getByRole('button', { name: /匯出備份/ }));
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:x');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('匯入', () => {
  it('先顯示題數，確認才合併；合併是聯集，不覆寫', async () => {
    put({ keep: 5 });
    render(<ReviewBackup />);
    choose(backup({ add: 3 }, { w: { streak: 0, last: 1 } }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('備份裡有星號 1 題、待複習錯題 1 題');
    expect(dialog).toHaveTextContent('會新增星號 1 題、待複習錯題 1 題');
    // 確認之前什麼都沒寫
    expect(saved().stars).toEqual({ keep: 5 });
    fireEvent.click(within(dialog).getByRole('button', { name: '確定合併' }));
    expect(saved().stars).toEqual({ keep: 5, add: 3 });
    expect(saved().wrong).toEqual({ w: { streak: 0, last: 1 } });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(status()).toHaveTextContent('已合併：新增星號 1 題、待複習錯題 1 題。');
  });

  it('數字是實際新增的題數，不是檔案裡的題數', async () => {
    put({ keep: 5 });
    render(<ReviewBackup />);
    choose(backup({ keep: 9, add: 3 }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('備份裡有星號 2 題、待複習錯題 0 題');
    expect(dialog).toHaveTextContent('會新增星號 1 題、待複習錯題 0 題');
    fireEvent.click(within(dialog).getByRole('button', { name: '確定合併' }));
    expect(status()).toHaveTextContent('已合併：新增星號 1 題、待複習錯題 0 題。');
  });

  it('重複匯入：看得出來沒有新增', async () => {
    put({ keep: 5 }, { w: { streak: 0, last: 1 } });
    render(<ReviewBackup />);
    choose(backup({ keep: 5 }, { w: { streak: 0, last: 1 } }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('備份裡的題目都已經在清單裡，不會新增。');
    fireEvent.click(within(dialog).getByRole('button', { name: '確定合併' }));
    expect(status()).toHaveTextContent('沒有新增：備份裡的題目都已經在清單裡。');
  });

  it('說明已移出的題目可能回到待複習；不說會覆蓋', async () => {
    render(<ReviewBackup />);
    choose(backup({}, { w: { streak: 0, last: 1 } }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('已經移出待複習的題目如果在備份裡，會回到待複習。');
    expect(dialog).toHaveTextContent('現有的紀錄不會被刪除');
  });

  it('題庫找不到的題目：說明保留但不會出題；主題庫與練習池的題目不算', async () => {
    const main = allQuestions[0].id;
    const poolItem = buildFixturePool().items[0].id;
    render(<ReviewBackup />);
    choose(backup({ [main]: 1, [poolItem]: 1, 'not-in-bank': 1 }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('有 1 題在目前的題庫找不到，會保留但不會出題。');
  });

  it('全部都找得到：不提', async () => {
    render(<ReviewBackup />);
    choose(backup({ [allQuestions[0].id]: 1 }));
    expect(await screen.findByRole('dialog')).not.toHaveTextContent('找不到');
  });

  it('練習池載不到：不說找不到（不知道），照常可以合併', async () => {
    vi.mocked(loadPracticePool).mockRejectedValueOnce(new Error('offline'));
    render(<ReviewBackup />);
    choose(backup({ 'not-in-bank': 1 }));
    expect(await screen.findByRole('dialog')).not.toHaveTextContent('找不到');
  });

  it('選新的檔案時，上一次的訊息先收掉', async () => {
    render(<ReviewBackup />);
    choose('{oops');
    await waitFor(() => expect(status()).toHaveTextContent(/沒有匯入/));
    choose(backup({ add: 3 }));
    await screen.findByRole('dialog');
    expect(status()).toHaveTextContent('');
  });

  it('取消：什麼都不寫', async () => {
    put({ keep: 5 });
    const before = store.get(REVIEW_STORAGE_KEY);
    render(<ReviewBackup />);
    choose(backup({ add: 3 }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(store.get(REVIEW_STORAGE_KEY)).toBe(before);
  });

  it('Esc 取消', async () => {
    render(<ReviewBackup />);
    choose(backup({ add: 3 }));
    await screen.findByRole('dialog');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(store.has(REVIEW_STORAGE_KEY)).toBe(false);
  });

  it('檢查不過：不開確認、什麼都不寫，並說出原因', async () => {
    put({ keep: 5 });
    const before = store.get(REVIEW_STORAGE_KEY);
    render(<ReviewBackup />);
    choose('{oops');
    await waitFor(() => expect(status()).toHaveTextContent('沒有匯入：這個檔案不是備份檔，內容無法讀取。'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(store.get(REVIEW_STORAGE_KEY)).toBe(before);
  });

  it('太大的檔案：不開確認，說出原因', async () => {
    render(<ReviewBackup />);
    const file = new File(['x'], 'big.json');
    Object.defineProperty(file, 'size', { value: REVIEW_IMPORT_MAX_BYTES + 1 });
    fireEvent.change(fileInput(), { target: { files: [file] } });
    await waitFor(() => expect(status()).toHaveTextContent(/太大/));
  });

  it('存不進去：說沒有匯入', async () => {
    render(<ReviewBackup />);
    choose(backup({ add: 3 }));
    const dialog = await screen.findByRole('dialog');
    localStorage.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    fireEvent.click(within(dialog).getByRole('button', { name: '確定合併' }));
    expect(status()).toHaveTextContent(/沒有匯入/);
  });

  it('選完之後清空 input：同一個檔案可以再選一次', async () => {
    render(<ReviewBackup />);
    const input = fileInput();
    let cleared = false;
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => '',
      set: (v: string) => {
        if (v === '') cleared = true;
      },
    });
    choose('{oops');
    await waitFor(() => expect(status()).toHaveTextContent(/沒有匯入/));
    expect(cleared).toBe(true);
  });

  it('關閉確認之後焦點回到匯入按鈕', async () => {
    render(<ReviewBackup />);
    const button = screen.getByRole('button', { name: /匯入備份/ });
    choose(backup({ add: 3 }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(button).toHaveFocus();
  });

  it('選檔 input 只收 JSON，匯入按鈕觸發它', () => {
    render(<ReviewBackup />);
    expect(fileInput().accept).toMatch(/json/);
    const click = vi.spyOn(fileInput(), 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: /匯入備份/ }));
    expect(click).toHaveBeenCalled();
  });
});

describe('清除', () => {
  it('清除星號：要確認，不動待複習，也不動作答統計', () => {
    store.set('ipas-question-stats', 'keep');
    put({ a: 1 }, { b: { streak: 0, last: 1 } });
    render(<ReviewBackup />);
    fireEvent.click(screen.getByRole('button', { name: /清除星號/ }));
    expect(saved().stars).toEqual({ a: 1 });
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '確定清除' }));
    expect(saved()).toMatchObject({ stars: {}, wrong: { b: { streak: 0, last: 1 } } });
    expect(store.get('ipas-question-stats')).toBe('keep');
    expect(status()).toHaveTextContent('已清除星號。');
  });

  it('清除待複習錯題：要確認，不動星號', () => {
    put({ a: 1 }, { b: { streak: 0, last: 1 } });
    render(<ReviewBackup />);
    fireEvent.click(screen.getByRole('button', { name: /清除待複習錯題/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '確定清除' }));
    expect(saved()).toMatchObject({ stars: { a: 1 }, wrong: {} });
    expect(status()).toHaveTextContent('已清除待複習錯題。');
  });

  it('取消、點背景、Esc 都不清除；背景點擊之內的 dialog 本身不關閉', () => {
    put({ a: 1 });
    render(<ReviewBackup />);
    const open = () => fireEvent.click(screen.getByRole('button', { name: /清除星號/ }));
    open();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    open();
    fireEvent.click(screen.getByText('清除星號？'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).toBeNull();
    open();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(saved().stars).toEqual({ a: 1 });
  });

  it.each([
    ['清除星號', { a: 1 }, {}],
    ['清除待複習錯題', {}, { b: { streak: 0, last: 1 } }],
  ])('%s存不進去：說沒有清除', (name, stars, wrong) => {
    put(stars, wrong);
    render(<ReviewBackup />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }));
    localStorage.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '確定清除' }));
    expect(status()).toHaveTextContent(/沒有清除/);
    expect(saved()).toMatchObject({ stars, wrong });
  });
});

describe('新版資料', () => {
  it('清除與匯入都不寫，說的是這個版本只能讀取', async () => {
    const raw = JSON.stringify({ v: 2, stars: { a: 1 }, wrong: {} });
    store.set(REVIEW_STORAGE_KEY, raw);
    render(<ReviewBackup />);
    fireEvent.click(screen.getByRole('button', { name: /清除星號/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '確定清除' }));
    expect(status()).toHaveTextContent('沒有清除：這份紀錄是新版網站寫入的，目前的版本只能讀取。');
    choose(backup({ add: 3 }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '確定合併' }));
    expect(status()).toHaveTextContent('沒有匯入：這份紀錄是新版網站寫入的');
    expect(store.get(REVIEW_STORAGE_KEY)).toBe(raw);
  });
});

describe('說明', () => {
  it('寫明資料只在瀏覽器裡、匯出的檔案就是備份', () => {
    render(<ReviewBackup />);
    expect(screen.getByText(/只存在這個瀏覽器/)).toHaveTextContent(/備份/);
  });
});

describe('改過 id 的題目', () => {
  // 2026-10-18：S1-p01-q004 改成 S_IPAS_SAMPLE_114_L11-q004。改名前匯出的備份帶著舊 id
  const OLD = 'S1-p01-q004';
  const CUR = 'S_IPAS_SAMPLE_114_L11-q004';

  it('舊 id 的備份：不說題庫找不到，已經有星號的題目不算新增，合併後存的是現在的 id', async () => {
    put({ [CUR]: 1 });
    render(<ReviewBackup />);
    choose(backup({ [OLD]: 1 }, { [OLD]: { streak: 0, last: 2 } }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).not.toHaveTextContent('找不到');
    expect(dialog).toHaveTextContent('會新增星號 0 題、待複習錯題 1 題。');
    expect(loadPracticePool).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '確定合併' }));
    expect(Object.keys(saved().stars)).toEqual([CUR]);
    expect(Object.keys(saved().wrong)).toEqual([CUR]);
  });
});

describe('網站資料被封鎖', () => {
  it('匯出：讀不到紀錄就不匯出空的備份，說明原因', () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      render(<ReviewBackup />);
      fireEvent.click(screen.getByRole('button', { name: /匯出備份/ }));
      expect(click).not.toHaveBeenCalled();
      expect(status()).toHaveTextContent('沒有匯出：讀不到這個瀏覽器裡的紀錄，瀏覽器可能封鎖了網站資料。');
    } finally {
      store = installRealLocalStorage();
    }
  });
});
