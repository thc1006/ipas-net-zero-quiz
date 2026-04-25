// HomePage component test — practice mode indicator + start callback
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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
    // h1 含 <em> 子節點 → jsdom accessible-name 會在 inline element 兩側補空白
    // 所以 "淨零碳<em>備考</em>神器" 的 name 是 "淨零碳 備考 神器"
    expect(
      screen.getByRole('heading', { level: 1, name: /淨零碳\s*備考\s*神器/ })
    ).toBeInTheDocument();
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

  it('subject card click switches subject (pickSubject)', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    // 點考科一卡片
    const subj1Card = screen.getAllByRole('radio').find(
      (el) => el.getAttribute('aria-label') !== '測驗模式'
        && el.textContent?.includes('§01')
    );
    expect(subj1Card).toBeTruthy();
    fireEvent.click(subj1Card!);
    fireEvent.click(screen.getByRole('button', { name: /開始/ }));
    expect(onStartQuiz.mock.calls[0][0].subject).toBe('考科1');
  });

  it('mode card click switches mode + showAnswerImmediately (pickMode)', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    // 找 exam mode card（含「考試」文字）
    const examCard = screen.getAllByRole('radio').find(
      (el) => el.textContent?.includes('考試')
    );
    expect(examCard).toBeTruthy();
    fireEvent.click(examCard!);
    fireEvent.click(screen.getByRole('button', { name: /開始/ }));
    const cfg = onStartQuiz.mock.calls[0][0];
    expect(cfg.mode).toBe('exam');
    expect(cfg.showAnswerImmediately).toBe(false);
  });

  it('count input change updates questionCount (handleCountChange)', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const countInput = screen.getByLabelText(/題數/) as HTMLInputElement;
    fireEvent.change(countInput, { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: /開始/ }));
    expect(onStartQuiz.mock.calls[0][0].questionCount).toBe(25);
  });

  it('shuffle checkbox toggles shuffleQuestions (handleShuffleChange)', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const shuffleCb = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(shuffleCb);
    fireEvent.click(screen.getByRole('button', { name: /開始/ }));
    expect(onStartQuiz.mock.calls[0][0].shuffleQuestions).toBe(true);
  });

  it('hidden subject select onChange path (handleSubjectChange)', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const select = screen.getByLabelText(/考科範圍 \(備援 select\)/) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '考科2' } });
    fireEvent.click(screen.getByRole('button', { name: /開始/ }));
    expect(onStartQuiz.mock.calls[0][0].subject).toBe('考科2');
  });

  it('hidden mode select onChange path (handleModeChange)', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const select = screen.getByLabelText(/測驗模式 \(備援 select\)/) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'exam' } });
    fireEvent.click(screen.getByRole('button', { name: /開始/ }));
    expect(onStartQuiz.mock.calls[0][0].mode).toBe('exam');
  });
});
