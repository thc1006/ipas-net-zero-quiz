// App component test — render flow + ErrorBoundary 包裹 + practice-mode wiring
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react';
import App from './App';
import { REPO_URL } from './data/app-meta';
import { DISCUSSIONS_URL, REPORT_URL } from './utils/feedback-url';
import { getSourceCandidates } from './data/questions';
import { officialExamLabel, officialSampleLabel } from './utils/official-exam';
import {
  __resetPracticePoolCacheForTesting,
  __setPracticePoolForTesting,
  loadPracticePool,
} from './utils/practice-pool';
import { buildFixturePool } from './utils/__fixtures__/practice-pool-fixture';
import type { QuizQuestion } from './types/quiz';

// #128：按下開始那一刻抽不到題目時，App 要留在原頁。首頁在可出題數是 0 時會停用開始按鈕，
// 正常操作走不到這裡；要驗 App 有照 startQuiz 的回傳值決定切不切頁，只能讓首頁算題數時照常、
// 按下開始之後抽題才落空。預設照常回傳（其他測試不受影響），sourceEmpty.value 為 true 時才回傳空陣列。
const sourceEmpty = vi.hoisted(() => ({ value: false }));
// 這一場的抽題範圍：混入練習池時（startQuizWithPool）與隨機的只出官方題目（pickFromSource）會呼叫這個函式，
// 全部題目而不混練習池時不會（走 getRandomQuestions）。一場抽 100 題要抽到練習池題是機率，這裡看的是範圍，不靠運氣
const drawRange = vi.hoisted(() => ({ value: null as QuizQuestion[] | null }));
vi.mock('./data/questions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./data/questions')>();
  return {
    ...actual,
    getSourceCandidates: (...args: Parameters<typeof actual.getSourceCandidates>) =>
      sourceEmpty.value ? [] : actual.getSourceCandidates(...args),
    getRandomQuestionsFromPool: (...args: Parameters<typeof actual.getRandomQuestionsFromPool>) => {
      drawRange.value = args[0];
      return actual.getRandomQuestionsFromPool(...args);
    },
  };
});

// 練習池 chunk 載不到：真實情境是部署新版後的舊分頁或斷線，dynamic import 會 reject。
// 擋在 import 這一層，走的是真的 loadPracticePool，重試才驗得到。
// factory 不用 importOriginal，真的練習池在 beforeAll 先載好：async 的 factory 還在等 importOriginal 載整份 JSON 時，
// practice-pool.ts 再 import 一次拿到的是沒有 mock 的原檔（Vitest mocker 原始碼自己註明：this will not work if user
// does Promise.all(import(), import())）。設定頁的測試開始載入練習池就結束了，機器忙時 factory 拖到「載不到」的測試，
// 那裡的 import 拿到真的練習池，測驗照常開始，preflight 偶爾紅
const poolBroken = vi.hoisted(() => ({ value: false }));
const actualPool = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('./data/practice_pool.json', () => ({
  get default() {
    if (poolBroken.value) throw new TypeError('Failed to fetch dynamically imported module');
    return actualPool.value;
  },
}));
beforeAll(async () => {
  actualPool.value = (await vi.importActual<{ default: unknown }>('./data/practice_pool.json')).default;
});

// 讓載入掛著：測試先走開，再放行，看晚到的結果會不會影響現在的畫面
const poolHold = vi.hoisted(() => ({ value: null as Promise<void> | null }));
vi.mock('./utils/practice-pool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils/practice-pool')>();
  return {
    ...actual,
    loadPracticePool: async () => {
      if (poolHold.value) await poolHold.value;
      return actual.loadPracticePool();
    },
  };
});

// 還原真實 localStorage（test-setup.ts mock 成空函式）
function installRealLocalStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k: string): string | null => store.get(k) ?? null,
      setItem: (k: string, v: string): void => { store.set(k, v); },
      removeItem: (k: string): void => { store.delete(k); },
      clear: (): void => { store.clear(); },
      key: (i: number): string | null => Array.from(store.keys())[i] ?? null,
      get length(): number { return store.size; },
    },
    writable: true,
    configurable: true,
  });
}

// 每個 test 前重設 matchMedia，讓每個測試都從同一個起點跑，不依賴前一個測試留下什麼。
// （Vitest 2 的 vi.restoreAllMocks 會把 test-setup 的 matchMedia mock 連實作一起清掉；
//   Vitest 4 起它只還原 vi.spyOn 建的 spy，不再動 vi.fn。）
function ensureMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeAll(() => { installRealLocalStorage(); });

beforeEach(() => {
  ensureMatchMedia();
  // VisitorCounter fetch mock — 避免 jsdom 真的去打網路
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
  // 避免首次自動彈 dialog 干擾路由測試
  localStorage.setItem('practice-pool-disclosure-seen', '1');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  sourceEmpty.value = false;
  drawRange.value = null;
  poolBroken.value = false;
  __resetPracticePoolCacheForTesting();
});

describe('App', () => {
  it('renders Header brand and HomePage by default', () => {
    render(<App />);
    expect(screen.getAllByText(/淨零碳備考神器/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/開啟設定/)).toBeInTheDocument();
  });

  it('navigates to settings page when 開啟設定 clicked, then returns', () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText(/開啟設定/));
    // SettingsPage 標題出現
    expect(screen.getByText(/^外觀$/)).toBeInTheDocument();
  });

  it('starts quiz from HomePage and lands on QuizPage', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /開始/ }));
    await waitFor(() => {
      expect(screen.getByText(/第\s*1\s*題/)).toBeInTheDocument();
    });
  });

  it('practice-mode enabled triggers async startQuizWithPool path', async () => {
    localStorage.setItem('practice-pool-enabled', '1');
    localStorage.setItem('practice-pool-ai-opt-in', '1');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /開始/ }));
    await waitFor(() => {
      expect(screen.getByText(/第\s*1\s*題/)).toBeInTheDocument();
    });
  });

  describe('練習池 chunk 載不到', () => {
    const reload = vi.fn();

    beforeEach(() => {
      localStorage.setItem('practice-pool-enabled', '1');
      localStorage.setItem('practice-pool-ai-opt-in', '1');
      reload.mockClear();
      vi.stubGlobal('location', { ...window.location, reload });
    });

    it('按開始：留在原頁，說明原因並提供重新載入', async () => {
      poolBroken.value = true;
      render(<App />);

      fireEvent.click(screen.getByRole('button', { name: /開始/ }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('題目載入失敗');
      expect(screen.queryByText(/第\s*1\s*題/)).not.toBeInTheDocument();

      fireEvent.click(within(alert).getByRole('button', { name: '重新載入' }));
      expect(reload).toHaveBeenCalledOnce();
    });

    it('關閉按鈕收起訊息', async () => {
      poolBroken.value = true;
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: /開始/ }));

      fireEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: '關閉' }));

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('換頁時訊息收起，回來也不再出現', async () => {
      poolBroken.value = true;
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: /開始/ }));
      await screen.findByRole('alert');

      fireEvent.click(screen.getByLabelText(/開啟設定/));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      // 設定頁也會載入練習池：等它結束，不留到下一個測試
      await act(() => loadPracticePool().catch(() => undefined));
    });

    it('停用加強練習池時訊息收起', async () => {
      poolBroken.value = true;
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: /開始/ }));
      await screen.findByRole('alert');

      fireEvent.click(screen.getByRole('button', { name: '停用加強練習池' }));

      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });

    it('訊息出現時焦點移到再試一次；重新載入會失去進行中的東西，不能一按 Enter 就發生', async () => {
      poolBroken.value = true;
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: /開始/ }));

      const alert = await screen.findByRole('alert');

      await waitFor(() => expect(within(alert).getByRole('button', { name: '再試一次' })).toHaveFocus());
    });

    it('再試一次用同一份設定重新開始', async () => {
      poolBroken.value = true;
      render(<App />);
      fireEvent.change(screen.getByLabelText('題數'), { target: { value: '7' } });
      fireEvent.click(screen.getByRole('button', { name: /開始/ }));
      const alert = await screen.findByRole('alert');

      poolBroken.value = false;
      fireEvent.click(within(alert).getByRole('button', { name: '再試一次' }));

      expect(await screen.findByText('1 / 7')).toBeInTheDocument();
    });

    describe('載入掛著的時候使用者走開', () => {
      let release = () => {};

      beforeEach(() => {
        poolHold.value = new Promise((resolve) => {
          release = resolve;
        });
      });

      afterEach(() => {
        poolHold.value = null;
      });

      const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

      it('去設定頁之後失敗：訊息不出現，焦點不被搶走', async () => {
        poolBroken.value = true;
        render(<App />);
        fireEvent.click(screen.getByRole('button', { name: /開始/ }));
        fireEvent.click(screen.getByLabelText(/開啟設定/));
        const back = screen.getByRole('button', { name: /返回首頁/ });
        back.focus();

        release();
        await settle();

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(back).toHaveFocus();
        await act(() => loadPracticePool().catch(() => undefined));
      });

      it('去設定頁之後成功：不會跳到測驗頁', async () => {
        render(<App />);
        fireEvent.click(screen.getByRole('button', { name: /開始/ }));
        fireEvent.click(screen.getByLabelText(/開啟設定/));

        release();
        await settle();

        expect(screen.getByText(/^外觀$/)).toBeInTheDocument();
      });

      it('按了繼續測驗之後成功：續作的 1 / 3 不被換成新的一場', async () => {
        localStorage.setItem(
          'ipas-quiz-in-progress-v2',
          JSON.stringify({
            version: 2,
            savedAt: 1,
            state: {
              isActive: true,
              questions: ['gist-1', 'gist-2', 'gist-3'],
              currentIndex: 0,
              answers: [],
              startTime: 1,
              config: {
                mode: 'practice',
                subject: 'all',
                questionCount: 3,
                shuffleQuestions: false,
                showAnswerImmediately: true,
              },
            },
          })
        );
        render(<App />);
        fireEvent.click(screen.getByRole('button', { name: /開始/ }));
        fireEvent.click(screen.getByRole('button', { name: /繼續測驗/ }));
        expect(await screen.findByText('1 / 3')).toBeInTheDocument();

        release();
        await settle();

        expect(screen.getByText('1 / 3')).toBeInTheDocument();
      });
    });

    it('再按一次開始成功時訊息消失', async () => {
      poolBroken.value = true;
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: /開始/ }));
      await screen.findByRole('alert');

      poolBroken.value = false;
      fireEvent.click(screen.getByRole('button', { name: /開始/ }));

      await waitFor(() => expect(screen.getByText(/第\s*1\s*題/)).toBeInTheDocument());
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('結果頁按再測一次走同一條路', async () => {
      render(<App />);
      fireEvent.change(screen.getByLabelText('題數'), { target: { value: '1' } });
      fireEvent.click(screen.getByRole('button', { name: /開始/ }));
      await screen.findByText(/第\s*1\s*題/);
      fireEvent.click(screen.getByRole('button', { name: /完成測驗/ }));
      const retry = await screen.findByRole('button', { name: /再測一次/ });

      poolBroken.value = true;
      __resetPracticePoolCacheForTesting(); // 這一場還沒載入過練習池
      fireEvent.click(retry);

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('題目載入失敗');
      expect(alert).toHaveTextContent('重新載入會清掉這份結果');
      expect(screen.getByRole('button', { name: /再測一次/ })).toBeInTheDocument();
    });
  });

  // App 依練習模式決定混不混練習池，按鈕在首頁與設定頁：不重新整理，切換當下就要算數
  describe('切換加強練習池之後的下一場', () => {
    beforeEach(() => {
      __setPracticePoolForTesting(buildFixturePool());
      localStorage.setItem('practice-pool-ai-opt-in', '1');
    });

    const startAndWait = async () => {
      fireEvent.click(screen.getByRole('button', { name: /開始/ }));
      await waitFor(() => expect(screen.getByText(/第\s*1\s*題/)).toBeInTheDocument());
    };
    const poolIdsInRange = () =>
      drawRange.value?.filter((q) => q.sourceType === 'practice_pool').map((q) => q.id);

    it('在首頁啟用：下一場混入練習池', async () => {
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: '啟用加強練習池' }));
      await startAndWait();
      expect(poolIdsInRange()).toContain('fixture-3'); // fixture 裡的 AI 產題
    });

    it('選過只出官方題目再切回全部題目：下一場照常混入練習池', async () => {
      localStorage.setItem('practice-pool-enabled', '1');
      render(<App />);
      fireEvent.change(screen.getByLabelText('題目來源'), { target: { value: 'official' } });
      fireEvent.change(screen.getByLabelText('題目來源'), { target: { value: 'all' } });
      await startAndWait();
      expect(poolIdsInRange()).toContain('fixture-3');
    });

    it('在首頁停用：下一場不混入練習池', async () => {
      localStorage.setItem('practice-pool-enabled', '1');
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: '停用加強練習池' }));
      await startAndWait();
      expect(drawRange.value).toBeNull();
    });

    it('別的分頁清掉 localStorage：下一場不混入練習池', async () => {
      localStorage.setItem('practice-pool-enabled', '1');
      render(<App />);
      act(() => {
        localStorage.clear();
        localStorage.setItem('practice-pool-disclosure-seen', '1');
        window.dispatchEvent(new StorageEvent('storage', { key: null }));
      });
      await startAndWait();
      expect(drawRange.value).toBeNull();
    });

    it('在設定頁啟用：回首頁後下一場混入練習池', async () => {
      render(<App />);
      fireEvent.click(screen.getByLabelText(/開啟設定/));
      fireEvent.click(screen.getByLabelText('啟用加強練習池'));
      fireEvent.click(screen.getByRole('button', { name: /返回首頁/ }));
      await startAndWait();
      expect(poolIdsInRange()).toContain('fixture-3');
    });

    it('在設定頁停用：回首頁後下一場不混入練習池', async () => {
      localStorage.setItem('practice-pool-enabled', '1');
      render(<App />);
      fireEvent.click(screen.getByLabelText(/開啟設定/));
      fireEvent.click(screen.getByLabelText('啟用加強練習池'));
      fireEvent.click(screen.getByRole('button', { name: /返回首頁/ }));
      await startAndWait();
      expect(drawRange.value).toBeNull();
    });
  });

  // #128：只出官方題目時，練習池啟用也不混入；「再測一次」沿用同一個題目來源
  it('只出官方題目：練習池啟用時也只出官方題目，再測一次也一樣', async () => {
    // 原卷順序的第一題是最早那一份（114 年版參考樣題）的第一題：題卡上標的是它的版次
    const first = getSourceCandidates('all', 'official')[0];
    const firstLabel = first.officialExam
      ? officialExamLabel(first.officialExam)
      : officialSampleLabel(first.officialSample!);
    expect(firstLabel).toBe('官方參考樣題（114 年版）');
    localStorage.setItem('practice-pool-enabled', '1');
    localStorage.setItem('practice-pool-ai-opt-in', '1');
    render(<App />);
    fireEvent.change(screen.getByLabelText('題目來源'), { target: { value: 'official' } });
    fireEvent.change(screen.getByLabelText('題數'), { target: { value: '1' } });
    // 不隨機：第一題固定是原卷順序的第一題，篩選若失效就會換成主題庫的第一題（必定轉紅，不靠機率）
    fireEvent.click(screen.getByLabelText('隨機出題順序'));
    fireEvent.click(screen.getByRole('button', { name: /開始/ }));
    await waitFor(() => expect(screen.getByText(/第\s*1\s*題/)).toBeInTheDocument());
    expect(screen.getByText(firstLabel)).toBeInTheDocument();

    fireEvent.click(document.querySelector('.option-item')!);
    fireEvent.click(screen.getByRole('button', { name: /完成測驗/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /再測一次/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /再測一次/ }));
    await waitFor(() => expect(screen.getByText(/第\s*1\s*題/)).toBeInTheDocument());
    expect(screen.getByText(firstLabel)).toBeInTheDocument();
  });

  it('官方題日後被拿掉標記：只拿掉那一題，其他進度留著', async () => {
    const [kept] = getSourceCandidates('all', 'official');
    localStorage.setItem(
      'ipas-quiz-in-progress-v2',
      JSON.stringify({
        version: 2,
        savedAt: Date.now(),
        state: {
          isActive: true,
          questions: ['gist-1', kept.id],
          currentIndex: 0,
          answers: [],
          startTime: Date.now(),
          config: {
            mode: 'practice',
            subject: 'all',
            questionCount: 2,
            shuffleQuestions: false,
            showAnswerImmediately: true,
            questionSource: 'official',
          },
        },
      })
    );
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '繼續測驗' }));
    await waitFor(() => expect(screen.getByText(/第\s*1\s*題/)).toBeInTheDocument());
    expect(document.querySelector('.question-card')).toHaveTextContent(kept.stem);
    expect(screen.getByText(/1\s*\/\s*1/)).toBeInTheDocument();
  });

  // 屬於來源的題目都不可計分、其餘可計分但不屬於來源：提示留著的話，按下去沒有題目可以續作，頁面不會動
  it('沒有題目可以續作：不顯示繼續測驗，清掉存檔', () => {
    localStorage.setItem(
      'ipas-quiz-in-progress-v2',
      JSON.stringify({
        version: 2,
        savedAt: Date.now(),
        state: {
          isActive: true,
          questions: [
            'gist-1',
            {
              id: 'revoked',
              stem: '撤掉答案的官方題',
              options: [],
              answer: null,
              hasAnswer: false,
              officialExam: { session: '115-01', subject: 'L11', question_number: 1 },
            },
          ],
          currentIndex: 0,
          answers: [],
          startTime: Date.now(),
          config: {
            mode: 'practice',
            subject: 'all',
            questionCount: 2,
            shuffleQuestions: false,
            showAnswerImmediately: true,
            questionSource: 'official',
          },
        },
      })
    );
    render(<App />);
    expect(screen.queryByRole('button', { name: '繼續測驗' })).toBeNull();
    expect(localStorage.getItem('ipas-quiz-in-progress-v2')).toBeNull();
  });

  describe('存檔的題目來源不對', () => {
    const save = (questionSource: unknown) =>
      localStorage.setItem(
        'ipas-quiz-in-progress-v2',
        JSON.stringify({
          version: 2,
          savedAt: Date.now(),
          state: {
            isActive: true,
            questions: ['gist-1', 'gist-2'],
            currentIndex: 0,
            answers: [],
            startTime: Date.now(),
            config: {
              mode: 'practice',
              subject: 'all',
              questionCount: 2,
              shuffleQuestions: false,
              showAnswerImmediately: true,
              questionSource,
            },
          },
        })
      );

    // 5：續作之後按再測一次，matchesSource 對數字呼叫 startsWith，頁面卡在結果頁。'official'：題目全是非官方題
    for (const questionSource of [5, 'official']) {
      it(`${JSON.stringify(questionSource)}：不顯示繼續測驗，可以開新的一場`, async () => {
        save(questionSource);
        render(<App />);
        expect(screen.queryByRole('button', { name: '繼續測驗' })).toBeNull();
        expect(localStorage.getItem('ipas-quiz-in-progress-v2')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /開始/ }));
        await waitFor(() => expect(screen.getByText(/第\s*1\s*題/)).toBeInTheDocument());
      });
    }
  });

  it('只出官方題目中途回首頁、繼續測驗：再測一次仍只出官方題目', async () => {
    const first = getSourceCandidates('all', 'official')[0];
    const firstLabel = officialSampleLabel(first.officialSample!);
    render(<App />);
    fireEvent.change(screen.getByLabelText('題目來源'), { target: { value: 'official' } });
    fireEvent.change(screen.getByLabelText('題數'), { target: { value: '1' } });
    fireEvent.click(screen.getByLabelText('隨機出題順序')); // 不隨機：第一題固定，不靠機率
    fireEvent.click(screen.getByRole('button', { name: /開始/ }));
    await waitFor(() => expect(screen.getByText(/第\s*1\s*題/)).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('回首頁'));
    fireEvent.click(await screen.findByRole('button', { name: '繼續測驗' }));
    await waitFor(() => expect(screen.getByText(/第\s*1\s*題/)).toBeInTheDocument());

    fireEvent.click(document.querySelector('.option-item')!);
    fireEvent.click(screen.getByRole('button', { name: /完成測驗/ }));
    fireEvent.click(await screen.findByRole('button', { name: /再測一次/ }));
    await waitFor(() => expect(screen.getByText(/第\s*1\s*題/)).toBeInTheDocument());
    expect(screen.getByText(firstLabel)).toBeInTheDocument();
  });

  for (const practice of [false, true]) {
    it(`抽不到題目時留在首頁，不會停在只剩 header 的空白測驗頁${practice ? '（練習池啟用）' : ''}`, async () => {
      if (practice) {
        localStorage.setItem('practice-pool-enabled', '1');
        localStorage.setItem('practice-pool-ai-opt-in', '1');
      }
      render(<App />);
      fireEvent.change(screen.getByLabelText('題目來源'), { target: { value: 'official' } });
      const start = screen.getByRole('button', { name: /開始/ });
      expect(start).toBeEnabled();
      sourceEmpty.value = true;
      fireEvent.click(start);
      await act(async () => {});
      expect(screen.getByLabelText('題目來源')).toBeInTheDocument();
      expect(document.querySelector('.question-card')).toBeNull();
    });
  }

  for (const practice of [false, true]) {
    it(`再測一次時抽不到題目：留在結果頁${practice ? '（練習池啟用）' : ''}`, async () => {
      if (practice) {
        localStorage.setItem('practice-pool-enabled', '1');
        localStorage.setItem('practice-pool-ai-opt-in', '1');
      }
      render(<App />);
      fireEvent.change(screen.getByLabelText('題目來源'), { target: { value: 'official' } });
      fireEvent.change(screen.getByLabelText('題數'), { target: { value: '1' } });
      fireEvent.click(screen.getByRole('button', { name: /開始/ }));
      await waitFor(() => expect(screen.getByText(/第\s*1\s*題/)).toBeInTheDocument());
      fireEvent.click(document.querySelector('.option-item')!);
      fireEvent.click(screen.getByRole('button', { name: /完成測驗/ }));
      const retry = await screen.findByRole('button', { name: /再測一次/ });
      sourceEmpty.value = true;
      fireEvent.click(retry);
      await act(async () => {});
      expect(screen.getByRole('button', { name: /再測一次/ })).toBeInTheDocument();
      expect(document.querySelector('.question-card')).toBeNull();
    });
  }

  it('Header 的回報問題開 issue 範本選單，討論區開 Discussions', () => {
    render(<App />);
    const header = within(screen.getByRole('banner'));
    expect(header.getByRole('link', { name: '回報問題' })).toHaveAttribute('href', REPORT_URL);
    expect(header.getByRole('link', { name: '討論區' })).toHaveAttribute('href', DISCUSSIONS_URL);
  });

  it('App wraps content in ErrorBoundary (renders children when no error)', () => {
    render(<App />);
    // No alert role visible — ErrorBoundary in passthrough mode
    expect(screen.queryByRole('alert')).toBeNull();
    // 主內容區有渲染
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('skip-link for accessibility points to main-content', () => {
    render(<App />);
    const skipLink = screen.getByText(/跳到主要內容/);
    expect(skipLink).toHaveAttribute('href', '#main-content');
  });

  // 還原放在 afterEach：測試逾時也要還原，否則同一檔後面的測試全部跟著丟 SecurityError
  describe('瀏覽器封鎖網站資料（讀 localStorage、sessionStorage 都丟 SecurityError）', () => {
    const descriptors = new Map<string, PropertyDescriptor>();

    beforeEach(() => {
      for (const name of ['localStorage', 'sessionStorage']) {
        descriptors.set(name, Object.getOwnPropertyDescriptor(window, name)!);
        Object.defineProperty(window, name, {
          configurable: true,
          get() {
            throw new DOMException('Access is denied for this document.', 'SecurityError');
          },
        });
      }
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ value: 7 }) })
      );
    });

    afterEach(() => {
      cleanup();
      for (const [name, descriptor] of descriptors) Object.defineProperty(window, name, descriptor);
    });

    it('頁面照常顯示，訪客計數也顯示', async () => {
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: /暫不啟用/ }));

      expect(screen.getByLabelText(/開啟設定/)).toBeInTheDocument();
      expect(await screen.findByLabelText('訪客人次：7')).toBeInTheDocument();
    });
  });

  it('頁尾：GitHub 專案、回報問題與討論區三個連結，各自指向自己的地方', () => {
    render(<App />);
    const footer = within(screen.getByRole('contentinfo'));
    for (const [name, href] of [
      ['GitHub 專案連結', REPO_URL],
      ['回報問題', REPORT_URL],
      ['討論區', DISCUSSIONS_URL],
    ]) {
      const link = footer.getByRole('link', { name });
      expect(link).toHaveAttribute('href', href);
      // 開新分頁，不打斷正在作答的測驗
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(footer.queryByText(/問題回報/)).toBeNull();
  });
});
