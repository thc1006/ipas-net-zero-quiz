// HomePage component test — practice mode indicator + start callback
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { HomePage } from './HomePage';


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

describe('HomePage', () => {
  it('renders title and stats badges', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    expect(screen.getByText(/淨零碳備考神器/)).toBeInTheDocument();
    // 考科一 / 考科二 出現多次（select option + badge），用 getAllByText
    expect(screen.getAllByText(/考科一/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/考科二/).length).toBeGreaterThan(0);
  });

  it('does NOT show practice-pool indicator when disabled', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    expect(screen.queryByText(/加強練習池啟用中/)).toBeNull();
  });

  it('shows practice-pool indicator when enabled', () => {
    localStorage.setItem('practice-pool-enabled', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    expect(screen.getByText(/加強練習池啟用中/)).toBeInTheDocument();
  });

  it('calls onStartQuiz with current config when 開始 clicked', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const startBtn = screen.getByRole('button', { name: /開始/ });
    fireEvent.click(startBtn);
    expect(onStartQuiz).toHaveBeenCalledOnce();
    const config = onStartQuiz.mock.calls[0][0];
    expect(config).toHaveProperty('mode');
    expect(config).toHaveProperty('subject');
    expect(config).toHaveProperty('questionCount');
  });

  // === 加強練習池入口（clickable badge）===

  it('shows clickable opt-in badge on disabled state', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    const optInBtn = screen.getByRole('button', { name: '啟用加強練習池' });
    expect(optInBtn).toBeInTheDocument();
    // 應顯示題數（151，與 practice_pool.json _meta.totals.total 同步）
    expect(optInBtn.textContent).toMatch(/151/);
  });

  it('clicking opt-in badge opens PracticeOptInDialog (first-time flow)', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    const optInBtn = screen.getByRole('button', { name: '啟用加強練習池' });
    fireEvent.click(optInBtn);
    // dialog 出現（aria-labelledby 指向 optin-title）
    expect(screen.getByRole('dialog', { name: /啟用加強練習池/ })).toBeInTheDocument();
  });

  it('accepting dialog enables practice mode + persists opt-in', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '啟用加強練習池' }));
    fireEvent.click(screen.getByRole('button', { name: /我已了解/ }));
    expect(localStorage.getItem('practice-pool-enabled')).toBe('1');
    expect(localStorage.getItem('practice-pool-ai-opt-in')).toBe('1');
    // dialog 關閉、原 opt-in badge 消失
    expect(screen.queryByRole('dialog', { name: /啟用加強練習池/ })).toBeNull();
  });

  it('once opted-in but disabled: clicking re-enables without re-opening dialog', () => {
    localStorage.setItem('practice-pool-ai-opt-in', '1');
    localStorage.setItem('practice-pool-enabled', '0');
    render(<HomePage onStartQuiz={() => {}} />);
    const optInBtn = screen.getByRole('button', { name: '啟用加強練習池' });
    fireEvent.click(optInBtn);
    expect(localStorage.getItem('practice-pool-enabled')).toBe('1');
    // 沒重開 dialog
    expect(screen.queryByRole('dialog', { name: /啟用加強練習池/ })).toBeNull();
  });

  it('clicking enabled-state badge disables practice mode', () => {
    localStorage.setItem('practice-pool-enabled', '1');
    localStorage.setItem('practice-pool-ai-opt-in', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    const enabledBadge = screen.getByRole('button', { name: /停用加強練習池/ });
    fireEvent.click(enabledBadge);
    expect(localStorage.getItem('practice-pool-enabled')).toBe('0');
  });

  // === 首次自動彈窗 + 永久持續 tip card ===

  it('first visit (no seen flag, no opt-in) auto-opens disclosure dialog', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    expect(screen.getByRole('dialog', { name: /啟用加強練習池/ })).toBeInTheDocument();
  });

  it('declining first-visit dialog records seen flag (no re-popup)', () => {
    const { unmount } = render(<HomePage onStartQuiz={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /暫不啟用/ }));
    expect(localStorage.getItem('practice-pool-disclosure-seen')).toBe('1');
    unmount();
    // 第二次進首頁，dialog 不再自動彈
    render(<HomePage onStartQuiz={() => {}} />);
    expect(screen.queryByRole('dialog', { name: /啟用加強練習池/ })).toBeNull();
  });

  it('does NOT auto-popup if already opted-in', () => {
    localStorage.setItem('practice-pool-ai-opt-in', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    expect(screen.queryByRole('dialog', { name: /啟用加強練習池/ })).toBeNull();
  });

  it('does NOT auto-popup if seen flag already set', () => {
    localStorage.setItem('practice-pool-disclosure-seen', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    expect(screen.queryByRole('dialog', { name: /啟用加強練習池/ })).toBeNull();
  });

  it('tip card always renders (never silently disappears) — disabled state', () => {
    localStorage.setItem('practice-pool-disclosure-seen', '1'); // 不彈 dialog
    render(<HomePage onStartQuiz={() => {}} />);
    const tip = screen.getByTestId('practice-pool-tip');
    expect(tip).toBeInTheDocument();
    expect(tip.textContent).toMatch(/55.*模擬.*96.*AI/);
    expect(tip.className).not.toMatch(/practice-pool-tip--enabled/);
  });

  it('tip card switches to enabled state (no disappearance) when practice mode is on', () => {
    localStorage.setItem('practice-pool-enabled', '1');
    localStorage.setItem('practice-pool-ai-opt-in', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    const tip = screen.getByTestId('practice-pool-tip');
    // 改用 modifier class 標記狀態，不再 unmount
    expect(tip.className).toMatch(/practice-pool-tip--enabled/);
    expect(tip.textContent).toMatch(/已啟用/);
    // CTA 變成停用按鈕（用 within 限定在 tip card 內，避免跟 badge 撞）
    expect(within(tip).getByRole('button')).toHaveTextContent(/停用加強練習/);
  });

  it('tip card CTA opens dialog (when not yet seen, !opted-in)', () => {
    localStorage.setItem('practice-pool-disclosure-seen', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    const cta = screen.getByRole('button', { name: /了解並啟用/ });
    fireEvent.click(cta);
    expect(screen.getByRole('dialog', { name: /啟用加強練習池/ })).toBeInTheDocument();
  });

  it('tip card CTA disables practice mode when enabled', () => {
    localStorage.setItem('practice-pool-enabled', '1');
    localStorage.setItem('practice-pool-ai-opt-in', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    const tip = screen.getByTestId('practice-pool-tip');
    fireEvent.click(within(tip).getByRole('button'));
    expect(localStorage.getItem('practice-pool-enabled')).toBe('0');
  });

  // === Config 控制元件 onChange handlers (補覆蓋) ===

  it('subject select change updates config.subject', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const select = screen.getByLabelText(/考科範圍/) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '考科1' } });
    fireEvent.click(screen.getByRole('button', { name: /開始/ }));
    expect(onStartQuiz.mock.calls[0][0].subject).toBe('考科1');
  });

  it('mode select change updates config.mode + showAnswerImmediately', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const select = screen.getByLabelText(/測驗模式/) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'exam' } });
    fireEvent.click(screen.getByRole('button', { name: /開始/ }));
    const cfg = onStartQuiz.mock.calls[0][0];
    expect(cfg.mode).toBe('exam');
    expect(cfg.showAnswerImmediately).toBe(false);
  });

  it('count input change updates config.questionCount (clamped 1-100)', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const input = screen.getByLabelText(/題數/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: /開始/ }));
    expect(onStartQuiz.mock.calls[0][0].questionCount).toBe(25);
  });

  it('count input clamps NaN to default 20', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const input = screen.getByLabelText(/題數/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: /開始/ }));
    expect(onStartQuiz.mock.calls[0][0].questionCount).toBe(20);
  });

  it('count input clamps over-max to 100', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const input = screen.getByLabelText(/題數/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /開始/ }));
    expect(onStartQuiz.mock.calls[0][0].questionCount).toBe(100);
  });

  it('shuffle checkbox toggles config.shuffleQuestions', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const cb = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.change(cb, { target: { checked: true } });
    fireEvent.click(screen.getByRole('button', { name: /開始/ }));
    expect(onStartQuiz.mock.calls[0][0].shuffleQuestions).toBe(true);
  });
});
