// PracticePoolHistogram 測試
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PracticePoolHistogram } from './PracticePoolHistogram';

afterEach(cleanup);

describe('PracticePoolHistogram', () => {
  it('renders 3 rows: 主題庫 / 模擬題 / AI 產題', () => {
    render(<PracticePoolHistogram mainBankCount={340} subject="考科1" />);
    expect(screen.getByText('主題庫')).toBeInTheDocument();
    expect(screen.getByText('模擬題')).toBeInTheDocument();
    expect(screen.getByText('AI 產題')).toBeInTheDocument();
  });

  it('shows mainBankCount + pool counts (考科1: 340 + 0 mock + 47 AI)', () => {
    const { container } = render(
      <PracticePoolHistogram mainBankCount={340} subject="考科1" />,
    );
    const counts = container.querySelectorAll('.pool-histogram__count');
    expect(counts[0].textContent).toBe('340'); // 主題庫
    expect(counts[1].textContent).toBe('0');   // 模擬題（考科1 沒 external_mock）
    expect(counts[2].textContent).toBe('47');  // AI 產題（含 ifrs_s1_s2_round_2026q2 +6）
  });

  it('shows all subject totals (647 + 54 + 100)', () => {
    const { container } = render(
      <PracticePoolHistogram mainBankCount={647} subject="all" />,
    );
    const counts = container.querySelectorAll('.pool-histogram__count');
    expect(counts[0].textContent).toBe('647');
    expect(counts[1].textContent).toBe('54');
    expect(counts[2].textContent).toBe('100');
  });

  it('shows total 題 sum at bottom', () => {
    const { container } = render(<PracticePoolHistogram mainBankCount={340} subject="考科1" />);
    // 總計 340 + 47 = 387（broken across <strong> 元素，用 textContent normalize 比對）
    const total = container.querySelector('.pool-histogram__total');
    expect(total?.textContent).toMatch(/共\s*387\s*題/);
  });

  it('handles 0 mainBank gracefully (no NaN%)', () => {
    render(<PracticePoolHistogram mainBankCount={0} subject="考科2" />);
    // total = 0 + 0 + 24 = 24，% 應該都是有效數字
    const pctTexts = screen.getAllByText(/\d+%/);
    pctTexts.forEach((el) => {
      expect(el.textContent).toMatch(/^\d+%$/);
    });
  });

  it('test-id attribute for outer container', () => {
    render(<PracticePoolHistogram mainBankCount={340} subject="考科1" />);
    expect(screen.getByTestId('pool-histogram')).toBeInTheDocument();
  });
});
