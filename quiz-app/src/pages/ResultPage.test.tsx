// ResultPage component test — covers Carbon Ledger audit report header,
// 4 score bands, ledger stats, wrong-list rendering, and action callbacks.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ResultPage } from './ResultPage';
import type { QuizResult, AnswerRecord } from '../types/quiz';

// 還原真實 localStorage（test-setup.ts 把它 mock 成空函式）
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

beforeEach(() => {
  // URL.createObjectURL / revokeObjectURL 在 jsdom 裡沒實作 — 給個 stub
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:fake'),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function makeResult(overrides: Partial<QuizResult> = {}): QuizResult {
  const answers: AnswerRecord[] = overrides.answers ?? [];
  return {
    config: {
      mode: 'practice',
      subject: 'all',
      questionCount: 10,
      shuffleQuestions: false,
      shuffleOptions: false,
      showAnswerImmediately: true,
      ...((overrides.config ?? {}) as Partial<QuizResult['config']>),
    },
    startTime: Date.now() - 600000,
    endTime: Date.now(),
    totalTime: 125000, // 2 分 5 秒
    answers,
    score: 95,
    totalAnswerable: 10,
    correctCount: 9,
    wrongCount: 1,
    skippedCount: 0,
    ...overrides,
  };
}

describe('ResultPage', () => {
  it('renders audit report head + BAND A for high score', () => {
    render(
      <ResultPage
        result={makeResult({ score: 95, correctCount: 10, wrongCount: 0 })}
        onGoHome={() => {}}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText(/AUDIT REPORT/)).toBeInTheDocument();
    expect(screen.getByText('BAND A')).toBeInTheDocument();
    expect(screen.getByText('太棒了！')).toBeInTheDocument();
    // ledger stats labels
    expect(screen.getByText(/CR \/ 答對/)).toBeInTheDocument();
    expect(screen.getByText(/DR \/ 答錯/)).toBeInTheDocument();
    expect(screen.getByText(/Σ \/ 總題數/)).toBeInTheDocument();
    expect(screen.getByText(/τ \/ 用時/)).toBeInTheDocument();
    // 用時格式化
    expect(screen.getByText(/2 分 5 秒/)).toBeInTheDocument();
  });

  it('shows BAND B for score 70-89', () => {
    render(
      <ResultPage
        result={makeResult({ score: 75 })}
        onGoHome={() => {}}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText('BAND B')).toBeInTheDocument();
    expect(screen.getByText('不錯喔！')).toBeInTheDocument();
  });

  it('shows BAND C for score 60-69', () => {
    render(
      <ResultPage
        result={makeResult({ score: 65 })}
        onGoHome={() => {}}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText('BAND C')).toBeInTheDocument();
    expect(screen.getByText('及格了！')).toBeInTheDocument();
  });

  it('shows BAND D and encourages retry for score < 60', () => {
    render(
      <ResultPage
        result={makeResult({ score: 40 })}
        onGoHome={() => {}}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText('BAND D')).toBeInTheDocument();
    expect(screen.getByText('再加油！')).toBeInTheDocument();
  });

  it('does NOT render wrong-section when no wrong answers', () => {
    render(
      <ResultPage
        result={makeResult({ wrongCount: 0, correctCount: 10, answers: [] })}
        onGoHome={() => {}}
        onRetry={() => {}}
      />
    );
    expect(screen.queryByText(/錯誤題目/)).toBeNull();
  });

  it('calls onGoHome and onRetry on action buttons', () => {
    const onGoHome = vi.fn();
    const onRetry = vi.fn();
    render(
      <ResultPage
        result={makeResult()}
        onGoHome={onGoHome}
        onRetry={onRetry}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /返回首頁/ }));
    fireEvent.click(screen.getByRole('button', { name: /再測一次/ }));
    expect(onGoHome).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('export button creates a download (URL.createObjectURL invoked)', () => {
    const createSpy = vi.fn(() => 'blob:fake');
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: createSpy,
      revokeObjectURL: vi.fn(),
    });
    render(
      <ResultPage
        result={makeResult()}
        onGoHome={() => {}}
        onRetry={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /匯出結果/ }));
    expect(createSpy).toHaveBeenCalledOnce();
  });
});
