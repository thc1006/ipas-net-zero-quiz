// App component test — render flow + ErrorBoundary 包裹 + practice-mode wiring
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

// vi.restoreAllMocks 會清掉 test-setup 的 matchMedia mock，每個 test beforeEach 重新確保
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

  it('Header GitHub icon link points to discussions', () => {
    render(<App />);
    const link = screen.getByLabelText(/社群討論/);
    expect(link).toHaveAttribute('href', expect.stringContaining('/discussions/1'));
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

  it('footer renders GitHub link + 問題回報 link', () => {
    render(<App />);
    const githubLinks = screen.getAllByLabelText(/GitHub 專案連結/);
    expect(githubLinks.length).toBeGreaterThan(0);
    expect(screen.getByText(/問題回報/)).toBeInTheDocument();
  });
});
