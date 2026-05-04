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

  it('calls onStartQuiz with current config when 開始測驗 clicked', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const startBtn = screen.getByRole('button', { name: /開始測驗/ });
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
    // 應顯示題數（157，與 practice_pool.json _meta.totals.total 同步）
    expect(optInBtn.textContent).toMatch(/157/);
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
    expect(tip.textContent).toMatch(/55.*模擬.*102.*AI/);
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

  // === 抽題分布 disclosure（progressive disclosure 預設收摺）===

  it('啟用練習池時，抽題分布預設為收摺（details not open）', () => {
    localStorage.setItem('practice-pool-enabled', '1');
    localStorage.setItem('practice-pool-ai-opt-in', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    const tip = screen.getByTestId('practice-pool-tip');
    const details = tip.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.hasAttribute('open')).toBe(false);
    // summary 文字存在、可被使用者點擊
    expect(within(tip).getByText(/查看抽題分布/)).toBeInTheDocument();
  });

  it('點擊 summary 會展開 details，histogram 變為 open 狀態', () => {
    localStorage.setItem('practice-pool-enabled', '1');
    localStorage.setItem('practice-pool-ai-opt-in', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    const tip = screen.getByTestId('practice-pool-tip');
    const details = tip.querySelector('details') as HTMLDetailsElement;
    const summary = tip.querySelector('summary') as HTMLElement;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
  });

  it('未啟用練習池時不渲染 details disclosure', () => {
    localStorage.setItem('practice-pool-disclosure-seen', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    const tip = screen.getByTestId('practice-pool-tip');
    expect(tip.querySelector('details')).toBeNull();
  });

  // === Config 控制元件 onChange handlers (補覆蓋) ===

  it('subject select change updates config.subject', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const select = screen.getByLabelText(/考科範圍/) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '考科1' } });
    fireEvent.click(screen.getByRole('button', { name: /開始測驗/ }));
    expect(onStartQuiz.mock.calls[0][0].subject).toBe('考科1');
  });

  it('mode select change updates config.mode + showAnswerImmediately', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const select = screen.getByLabelText(/測驗模式/) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'exam' } });
    fireEvent.click(screen.getByRole('button', { name: /開始測驗/ }));
    const cfg = onStartQuiz.mock.calls[0][0];
    expect(cfg.mode).toBe('exam');
    expect(cfg.showAnswerImmediately).toBe(false);
  });

  it('count input change updates config.questionCount (clamped 1-100)', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const input = screen.getByLabelText(/題數/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: /開始測驗/ }));
    expect(onStartQuiz.mock.calls[0][0].questionCount).toBe(25);
  });

  it('count input below minimum (0): 開始測驗 disabled', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const input = screen.getByLabelText(/題數/) as HTMLInputElement;
    const startBtn = screen.getByRole('button', { name: /開始測驗/ });
    fireEvent.change(input, { target: { value: '0' } });
    expect(input.value).toBe('0');
    expect(startBtn).toBeDisabled();
    fireEvent.click(startBtn);
    expect(onStartQuiz).not.toHaveBeenCalled();
  });

  it('count input empty: 開始測驗 disabled', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    const input = screen.getByLabelText(/題數/) as HTMLInputElement;
    const startBtn = screen.getByRole('button', { name: /開始測驗/ });
    fireEvent.change(input, { target: { value: '' } });
    expect(startBtn).toBeDisabled();
  });

  it('count input clamps over-max to 100', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const input = screen.getByLabelText(/題數/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /開始測驗/ }));
    expect(onStartQuiz.mock.calls[0][0].questionCount).toBe(100);
  });

  it('count input over-max syncs displayed value to 100 on blur', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    const input = screen.getByLabelText(/題數/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '500' } });
    expect(input.value).toBe('500');
    fireEvent.blur(input);
    expect(input.value).toBe('100');
  });

  it('count input rejects decimals and trailing text (button disabled)', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const input = screen.getByLabelText(/題數/) as HTMLInputElement;
    const startBtn = screen.getByRole('button', { name: /開始測驗/ });

    fireEvent.change(input, { target: { value: '1.5' } });
    expect(startBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: '12abc' } });
    expect(startBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: '-5' } });
    expect(startBtn).toBeDisabled();

    fireEvent.click(startBtn);
    expect(onStartQuiz).not.toHaveBeenCalled();
  });

  it('count input invalid → aria-invalid=true and hint is a polite live region', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    const input = screen.getByLabelText(/題數/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const hintId = input.getAttribute('aria-describedby');
    expect(hintId).toBeTruthy();
    const hint = document.getElementById(hintId!);
    expect(hint).not.toBeNull();
    // 常駐 live region：role=status + aria-live=polite，避免 role 切換時 SR 不可靠 announce
    expect(hint?.getAttribute('role')).toBe('status');
    expect(hint?.getAttribute('aria-live')).toBe('polite');
    expect(hint?.textContent).toMatch(/才能開始測驗/);
  });

  it('count input invalid → valid: aria-invalid recovers to false', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    const input = screen.getByLabelText(/題數/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(input, { target: { value: '20' } });
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(screen.getByRole('button', { name: /開始測驗/ })).not.toBeDisabled();
  });

  it('count input blur normalizes leading zeros', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    const input = screen.getByLabelText(/題數/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '050' } });
    fireEvent.blur(input);
    expect(input.value).toBe('50');
  });

  it('shuffle checkbox toggles config.shuffleQuestions', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const cb = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.change(cb, { target: { checked: true } });
    fireEvent.click(screen.getByRole('button', { name: /開始測驗/ }));
    expect(onStartQuiz.mock.calls[0][0].shuffleQuestions).toBe(true);
  });

  // === Resume hint（Refs #71）===

  it('localStorage 無進度時不顯示 resume hint', () => {
    render(<HomePage onStartQuiz={() => {}} onResumeQuiz={() => {}} />);
    expect(screen.queryByTestId('resume-hint')).toBeNull();
  });

  it('localStorage 有有效進度時顯示 resume hint + 繼續測驗 link', () => {
    localStorage.setItem(
      'ipas-quiz-in-progress',
      JSON.stringify({
        version: 1,
        savedAt: Date.now() - 5 * 60_000, // 5 分鐘前
        state: {
          isActive: true,
          questions: new Array(20).fill(null),
          currentIndex: 7,
          answers: new Array(7).fill({ questionId: 'x' }),
          startTime: Date.now(),
          config: null,
        },
      })
    );
    render(<HomePage onStartQuiz={() => {}} onResumeQuiz={() => {}} />);
    const hint = screen.getByTestId('resume-hint');
    expect(hint).toBeInTheDocument();
    expect(hint.textContent).toMatch(/已答 7 \/ 20 題/);
    expect(hint.textContent).toMatch(/分鐘前/);
    expect(within(hint).getByRole('button', { name: /繼續測驗/ })).toBeInTheDocument();
  });

  it('點擊「繼續測驗」呼叫 onResumeQuiz', () => {
    localStorage.setItem(
      'ipas-quiz-in-progress',
      JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        state: {
          isActive: true,
          questions: new Array(10).fill(null),
          currentIndex: 3,
          answers: new Array(3).fill({ questionId: 'x' }),
          startTime: Date.now(),
          config: null,
        },
      })
    );
    const onResume = vi.fn();
    render(<HomePage onStartQuiz={() => {}} onResumeQuiz={onResume} />);
    fireEvent.click(screen.getByRole('button', { name: /繼續測驗/ }));
    expect(onResume).toHaveBeenCalledOnce();
  });

  it('未提供 onResumeQuiz prop 時即使有進度也不顯示 hint（避免悬空 link）', () => {
    localStorage.setItem(
      'ipas-quiz-in-progress',
      JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        state: {
          isActive: true,
          questions: new Array(5).fill(null),
          currentIndex: 1,
          answers: [],
          startTime: Date.now(),
          config: null,
        },
      })
    );
    render(<HomePage onStartQuiz={() => {}} />);
    expect(screen.queryByTestId('resume-hint')).toBeNull();
  });
});
