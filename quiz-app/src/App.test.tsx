// App component test — covers practice-mode wiring from PR #34
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import App from './App';

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

// test-setup.ts 已 mock matchMedia，但 vi.restoreAllMocks 會清掉；每個 test 重新確保
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
  // mock fetch（VisitorCounter 啟動時呼叫）— 預設失敗讓元件回 null
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('renders Header brand and HomePage by default', () => {
    render(<App />);
    expect(screen.getAllByText(/淨零碳備考神器/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/開啟設定/)).toBeInTheDocument();
  });

  it('navigates to settings page when 開啟設定 clicked', () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText(/開啟設定/));
    expect(screen.getByText(/^外觀$/)).toBeInTheDocument();
    expect(screen.getByText(/^無障礙$/)).toBeInTheDocument();
  });

  it('starts quiz from HomePage and lands on QuizPage', async () => {
    render(<App />);
    const startBtn = screen.getByRole('button', { name: /開始/ });
    fireEvent.click(startBtn);
    // QuizPage shows question card with at least an option button
    await waitFor(() => {
      // 第 X 題 indicator
      expect(screen.getByText(/第\s*1\s*題/)).toBeInTheDocument();
    });
  });

  it('practice-mode enabled triggers async startQuizWithPool path', async () => {
    localStorage.setItem('practice-pool-enabled', '1');
    localStorage.setItem('practice-pool-ai-opt-in', '1');
    render(<App />);
    const startBtn = screen.getByRole('button', { name: /開始/ });
    fireEvent.click(startBtn);
    // 練習池載入是 async，等到 quiz page 出現
    await waitFor(() => {
      expect(screen.getByText(/第\s*1\s*題/)).toBeInTheDocument();
    });
  });

  it('Header GitHub icon link points to discussions', () => {
    render(<App />);
    const link = screen.getByLabelText(/社群討論/);
    expect(link).toHaveAttribute('href', expect.stringContaining('/discussions/1'));
  });
});
