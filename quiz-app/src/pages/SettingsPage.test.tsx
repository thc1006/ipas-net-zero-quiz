// SettingsPage component test — practice toggle + opt-in dialog flow
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// Mock usePracticePool 避免背景 fetch 造成 act warning（pre-existing pattern issue）
vi.mock('../hooks/usePracticePool', () => ({
  usePracticePool: () => ({
    pool: { _meta: { totals: { total: 0, external_mock: 0, ai_generated: 0 } } },
  }),
}));

import { SettingsPage } from './SettingsPage';
import { useAccessibility } from '../hooks/useAccessibility';
import { renderHook } from '@testing-library/react';


// 還原真實 localStorage 行為（test-setup.ts 把它 mock 成空函式）
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

beforeAll(() => { installRealLocalStorage(); });

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderSettings(onClose = () => {}) {
  const { result: accResult } = renderHook(() => useAccessibility());
  return render(<SettingsPage accessibility={accResult.current} onClose={onClose} />);
}

describe('SettingsPage', () => {
  it('renders main sections', () => {
    renderSettings();
    expect(screen.getByText(/外觀/)).toBeInTheDocument();
    expect(screen.getByText(/無障礙/)).toBeInTheDocument();
    expect(screen.getByText(/加強練習池/)).toBeInTheDocument();
  });

  it('clicking 「返回首頁」 button calls onClose', () => {
    const onClose = vi.fn();
    renderSettings(onClose);
    // Refs #72：原 X icon-only 按鈕改為「返回首頁」明確文字按鈕，
    // 走 visible text 為 accessible name（無 aria-label，避免 WCAG SC 2.5.3 違反）
    fireEvent.click(screen.getByRole('button', { name: /返回首頁/ }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('practice-pool toggle with no opt-in opens dialog', async () => {
    renderSettings();
    const toggle = screen.getByLabelText('啟用加強練習池');
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('practice-pool toggle with prior opt-in skips dialog and enables', () => {
    localStorage.setItem('practice-pool-ai-opt-in', '1');
    renderSettings();
    const toggle = screen.getByLabelText('啟用加強練習池') as HTMLInputElement;
    fireEvent.click(toggle);
    expect(localStorage.getItem('practice-pool-enabled')).toBe('1');
  });

  it('toggle when already enabled disables', () => {
    localStorage.setItem('practice-pool-ai-opt-in', '1');
    localStorage.setItem('practice-pool-enabled', '1');
    renderSettings();
    const toggle = screen.getByLabelText('啟用加強練習池') as HTMLInputElement;
    fireEvent.click(toggle);
    expect(localStorage.getItem('practice-pool-enabled')).toBe('0');
  });

  // 清除作答統計（Refs #64）— state-driven dialog，取代 window.confirm
  describe('清除作答統計', () => {
    const STATS_KEY = 'ipas-question-stats';
    const sampleStats = JSON.stringify({
      version: 1,
      items: { q1: { attempts: 3, correct: 1, lastTriedAt: 1 } },
    });

    it('點清除按鈕開啟確認 dialog，「確定清除」呼叫 clearStats 並關閉', () => {
      localStorage.setItem(STATS_KEY, sampleStats);
      renderSettings();

      // dialog 預設關閉
      expect(screen.queryByRole('dialog', { name: /清除作答統計/ })).not.toBeInTheDocument();

      // 點外面的 trigger 按鈕（注意：dialog 內也有「確定清除」會被 getAll 抓到）
      fireEvent.click(screen.getByRole('button', { name: '清除作答統計' }));
      const dialog = screen.getByRole('dialog', { name: /清除作答統計/ });
      expect(dialog).toBeInTheDocument();

      // dialog 內的「確定清除」
      fireEvent.click(screen.getByRole('button', { name: /確定清除/ }));
      expect(localStorage.getItem(STATS_KEY)).toBeNull();
      expect(screen.queryByRole('dialog', { name: /清除作答統計/ })).not.toBeInTheDocument();
    });

    it('點「取消」不清除、關閉 dialog', () => {
      localStorage.setItem(STATS_KEY, sampleStats);
      renderSettings();
      fireEvent.click(screen.getByRole('button', { name: '清除作答統計' }));
      fireEvent.click(screen.getByRole('button', { name: /^取消$/ }));
      expect(localStorage.getItem(STATS_KEY)).toBe(sampleStats);
      expect(screen.queryByRole('dialog', { name: /清除作答統計/ })).not.toBeInTheDocument();
    });

    it('ESC 鍵關閉 dialog（a11y）', () => {
      renderSettings();
      fireEvent.click(screen.getByRole('button', { name: '清除作答統計' }));
      expect(screen.getByRole('dialog', { name: /清除作答統計/ })).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: /清除作答統計/ })).not.toBeInTheDocument();
    });

    it('點 overlay 背景關閉 dialog', () => {
      renderSettings();
      fireEvent.click(screen.getByRole('button', { name: '清除作答統計' }));
      // role=dialog 元素本身就是 overlay；其 onClick 觸發 close
      // 內層 .settings-confirm-dialog 用 stopPropagation 阻擋自身 click 冒泡
      const overlay = screen.getByRole('dialog', { name: /清除作答統計/ });
      fireEvent.click(overlay);
      expect(screen.queryByRole('dialog', { name: /清除作答統計/ })).not.toBeInTheDocument();
    });
  });
});
