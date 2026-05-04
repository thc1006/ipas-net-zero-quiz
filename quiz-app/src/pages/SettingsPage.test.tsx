// SettingsPage component test — practice toggle + opt-in dialog flow
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
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

  // 清除作答統計按鈕（Refs #64）
  describe('清除作答統計', () => {
    const STATS_KEY = 'ipas-question-stats';
    const sampleStats = JSON.stringify({
      version: 1,
      items: { q1: { attempts: 3, correct: 1, lastTriedAt: 1 } },
    });

    it('confirm 確認時呼叫 clearStats，移除 localStorage 紀錄', () => {
      localStorage.setItem(STATS_KEY, sampleStats);
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      renderSettings();
      fireEvent.click(screen.getByRole('button', { name: /清除作答統計/ }));
      expect(confirmSpy).toHaveBeenCalled();
      expect(localStorage.getItem(STATS_KEY)).toBeNull();
      confirmSpy.mockRestore();
    });

    it('confirm 取消時不清除', () => {
      localStorage.setItem(STATS_KEY, sampleStats);
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      renderSettings();
      fireEvent.click(screen.getByRole('button', { name: /清除作答統計/ }));
      expect(localStorage.getItem(STATS_KEY)).toBe(sampleStats);
      confirmSpy.mockRestore();
    });
  });
});
