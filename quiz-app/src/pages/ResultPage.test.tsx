// ResultPage smoke + branch coverage
// 重點：score 評語分支、stats 渲染、wrongAnswers 分支、handleExport、操作按鈕。
// AI streaming 路徑需要 puter.js 全 mock，屬整合測試範疇，不在此檔涵蓋。
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { QuizResult, QuizQuestion, AnswerRecord } from '../types/quiz';

// 在 import ResultPage 前先 mock 資料層，否則 ResultPage import 時會吃真實題庫
vi.mock('../data/questions', () => {
  const baseOptions = [
    { key: 'A', text: 'CO2' },
    { key: 'B', text: 'O2' },
    { key: 'C', text: 'N2' },
    { key: 'D', text: 'Ar' },
  ];
  const fixture: QuizQuestion = {
    id: 'fx-001',
    number: 1,
    stem: '測試題目：下列何者為溫室氣體？',
    options: baseOptions,
    answer: 'A',
    subject: '考科1',
    section: 'fixture',
    explanation: '二氧化碳為主要溫室氣體',
  } as unknown as QuizQuestion;
  // Refs #64：weak-section 測試需要多個可解析的 id
  const weakFixtures: Record<string, QuizQuestion> = {
    'fx-weak-1': { ...fixture, id: 'fx-weak-1', stem: '弱題一：題幹一' },
    'fx-weak-2': { ...fixture, id: 'fx-weak-2', stem: '弱題二：題幹二' },
    'fx-strong': { ...fixture, id: 'fx-strong', stem: '強題（不該出現）' },
  };
  const all = [fixture, ...Object.values(weakFixtures)];
  return {
    allQuestions: all,
    getQuestionById: (id: string) =>
      id === 'fx-001' ? fixture : weakFixtures[id] ?? undefined,
    getSimilarQuestions: () => [],
    stats: { total: all.length, subject1: all.length, subject2: 0 },
  };
});

// ai-helper streaming 函式不執行（不寫 AI 測試）
vi.mock('../utils/ai-helper', () => ({
  explainQuestionStream: vi.fn(),
  generateSimilarQuestionStream: vi.fn(),
}));

import { ResultPage } from './ResultPage';

afterEach(() => {
  cleanup();
  // 還原 prototype spy（如 HTMLAnchorElement.prototype.click），避免跨測試殘留
  vi.restoreAllMocks();
});

beforeAll(() => {
  // jsdom 沒實作 createObjectURL / revokeObjectURL — handleExport 需要
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:mock'),
      writable: true,
    });
  }
  if (!URL.revokeObjectURL) {
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      writable: true,
    });
  }
});

function makeAnswer(overrides: Partial<AnswerRecord> = {}): AnswerRecord {
  return {
    questionId: 'fx-001',
    selectedAnswer: 'B',
    correctAnswer: 'A',
    isCorrect: false,
    timeSpent: 5000,
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeResult(overrides: Partial<QuizResult> = {}): QuizResult {
  return {
    config: {
      mode: 'practice',
      subject: 'all',
      questionCount: 1,
      shuffleQuestions: false,
      shuffleOptions: false,
      showAnswerImmediately: true,
    },
    startTime: 1_700_000_000_000,
    endTime: 1_700_000_065_000,
    totalTime: 65_000,
    answers: [],
    score: 100,
    totalAnswerable: 1,
    correctCount: 1,
    wrongCount: 0,
    skippedCount: 0,
    ...overrides,
  };
}

describe('ResultPage', () => {
  it('renders score, formatted time, and base stats', () => {
    render(
      <ResultPage
        result={makeResult({ score: 88, totalTime: 125_000 })}
        onGoHome={() => {}}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText('88')).toBeInTheDocument();
    expect(screen.getByText(/2 分 5 秒/)).toBeInTheDocument();
  });

  it.each([
    [100, /太棒了/],
    [95, /太棒了/],
    [90, /太棒了/], // 邊界
    [89, /不錯喔/], // 邊界（90 邊界另一側）
    [75, /不錯喔/],
    [70, /不錯喔/], // 邊界
    [69, /及格了/], // 邊界（70 邊界另一側）
    [60, /及格了/], // 邊界
  ])('score=%i → 顯示對應評語 %s', (score, pattern) => {
    render(
      <ResultPage result={makeResult({ score })} onGoHome={() => {}} onRetry={() => {}} />
    );
    expect(screen.getByText(pattern)).toBeInTheDocument();
  });

  it('score < 60 → 再加油 評語', () => {
    render(
      <ResultPage result={makeResult({ score: 30 })} onGoHome={() => {}} onRetry={() => {}} />
    );
    expect(screen.getByText(/再加油/)).toBeInTheDocument();
  });

  it('no wrong answers → does not render 錯誤題目 section', () => {
    render(
      <ResultPage result={makeResult()} onGoHome={() => {}} onRetry={() => {}} />
    );
    expect(screen.queryByText(/錯誤題目/)).toBeNull();
  });

  it('with wrong answers → renders 錯誤題目 section + AI 免責 + 題庫相似題 toggle', () => {
    render(
      <ResultPage
        result={makeResult({
          score: 0,
          correctCount: 0,
          wrongCount: 1,
          answers: [makeAnswer()],
        })}
        onGoHome={() => {}}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText(/錯誤題目 \(1 題\)/)).toBeInTheDocument();
    expect(screen.getByText(/AI 輔助功能說明/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AI 解析/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AI 生成相似題/ })).toBeInTheDocument();

    // toggle 題庫相似題（getSimilarQuestions 已 mock 為空陣列，分支仍走過）
    const bankBtn = screen.getByRole('button', { name: /題庫相似題/ });
    fireEvent.click(bankBtn);
    expect(screen.getByRole('button', { name: /收起題庫相似題/ })).toBeInTheDocument();
  });

  it('onGoHome / onRetry 按鈕觸發 callback', () => {
    const onGoHome = vi.fn();
    const onRetry = vi.fn();
    render(
      <ResultPage result={makeResult()} onGoHome={onGoHome} onRetry={onRetry} />
    );
    fireEvent.click(screen.getByRole('button', { name: /返回首頁/ }));
    fireEvent.click(screen.getByRole('button', { name: /再測一次/ }));
    expect(onGoHome).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('匯出結果：呼叫 createObjectURL + a.click + revokeObjectURL', () => {
    const createSpy = vi.spyOn(URL, 'createObjectURL');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    render(
      <ResultPage
        result={makeResult({
          wrongCount: 1,
          answers: [makeAnswer()],
        })}
        onGoHome={() => {}}
        onRetry={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /匯出結果/ }));

    expect(createSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalled();
  });

  it('wrongAnswers 中找不到題目 → 該項以 null 跳過、不 throw', () => {
    render(
      <ResultPage
        result={makeResult({
          wrongCount: 1,
          answers: [makeAnswer({ questionId: 'unknown-id' })],
        })}
        onGoHome={() => {}}
        onRetry={() => {}}
      />
    );
    // section 仍渲染，但內部沒有 wrong-item
    expect(screen.getByText(/錯誤題目 \(1 題\)/)).toBeInTheDocument();
  });

  // === 最常答錯 weak-section（Refs #64）===
  describe('最常答錯 section', () => {
    function installStatsLocalStorage(
      items: Record<string, { attempts: number; correct: number; lastTriedAt: number }>
    ) {
      const store = new Map<string, string>();
      if (Object.keys(items).length > 0) {
        store.set('ipas-question-stats', JSON.stringify({ version: 1, items }));
      }
      Object.defineProperty(globalThis, 'localStorage', {
        value: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => store.set(k, v),
          removeItem: (k: string) => {
            store.delete(k);
          },
          clear: () => store.clear(),
          key: (i: number) => Array.from(store.keys())[i] ?? null,
          get length() {
            return store.size;
          },
        },
        writable: true,
        configurable: true,
      });
    }

    it('完全沒 stats 時不渲染 weak-section', () => {
      installStatsLocalStorage({});
      render(<ResultPage result={makeResult()} onGoHome={() => {}} onRetry={() => {}} />);
      expect(screen.queryByTestId('weak-section')).not.toBeInTheDocument();
    });

    it('attempts < 3 或 rate >= 0.5 時不渲染 weak-section', () => {
      installStatsLocalStorage({
        'fx-strong': { attempts: 5, correct: 5, lastTriedAt: 1 }, // 100% 過濾
        'fx-weak-1': { attempts: 2, correct: 0, lastTriedAt: 2 }, // attempts 不足
      });
      render(<ResultPage result={makeResult()} onGoHome={() => {}} onRetry={() => {}} />);
      expect(screen.queryByTestId('weak-section')).not.toBeInTheDocument();
    });

    it('有 weak 題目時渲染 + 題幹 + 答對率 + 順序（rate 升冪）', () => {
      installStatsLocalStorage({
        'fx-weak-1': { attempts: 5, correct: 1, lastTriedAt: 100 }, // 20%
        'fx-weak-2': { attempts: 4, correct: 1, lastTriedAt: 200 }, // 25%
        'fx-strong': { attempts: 5, correct: 5, lastTriedAt: 300 }, // 100% 過濾
      });
      render(<ResultPage result={makeResult()} onGoHome={() => {}} onRetry={() => {}} />);

      const section = screen.getByTestId('weak-section');
      expect(section).toBeInTheDocument();
      expect(section).toHaveTextContent('弱題一');
      expect(section).toHaveTextContent('弱題二');
      expect(section).not.toHaveTextContent('強題');
      expect(section).toHaveTextContent('20%');
      expect(section).toHaveTextContent('25%');
      // rate 升冪：20% 在 25% 之前
      const html = section.innerHTML;
      expect(html.indexOf('弱題一')).toBeLessThan(html.indexOf('弱題二'));
    });

    it('找不到題幹（getQuestionById 回 undefined）的 stats 被過濾', () => {
      installStatsLocalStorage({
        'unknown-orphan': { attempts: 10, correct: 0, lastTriedAt: 1 },
        'fx-weak-1': { attempts: 5, correct: 2, lastTriedAt: 2 }, // 40%
      });
      render(<ResultPage result={makeResult()} onGoHome={() => {}} onRetry={() => {}} />);
      const section = screen.getByTestId('weak-section');
      expect(section).toHaveTextContent('弱題一');
      expect(section).not.toHaveTextContent('unknown-orphan');
    });
  });
});
