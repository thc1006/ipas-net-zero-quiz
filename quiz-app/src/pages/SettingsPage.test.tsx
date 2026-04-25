// SettingsPage component test — practice toggle + opt-in dialog flow
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { SettingsPage } from './SettingsPage';
import { useAccessibility } from '../hooks/useAccessibility';
import { renderHook } from '@testing-library/react';

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

  it('clicking close button calls onClose', () => {
    const onClose = vi.fn();
    renderSettings(onClose);
    fireEvent.click(screen.getByLabelText('關閉設定'));
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
});
