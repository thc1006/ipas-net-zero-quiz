// QuestionCard 元件測試（TDD - 先寫測試）
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuestionCard } from './QuestionCard';
import type { QuizQuestion } from '../../types/quiz';

const mockQuestion: QuizQuestion = {
  id: 'test-1',
  stem: '下列何者屬於溫室氣體？',
  options: [
    { key: 'A', text: '二氧化碳 (CO₂)' },
    { key: 'B', text: '氧氣 (O₂)' },
    { key: 'C', text: '氮氣 (N₂)' },
    { key: 'D', text: '氬氣 (Ar)' },
  ],
  answer: 'A',
  subject: '考科1',
  sourceType: 'gist',
  year: null,
  hasAnswer: true,
};

describe('QuestionCard 元件', () => {
  describe('基本渲染', () => {
    it('應顯示題目題幹', () => {
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          onSelectAnswer={vi.fn()}
        />
      );

      expect(screen.getByText(/下列何者屬於溫室氣體/)).toBeInTheDocument();
    });

    it('應顯示題號', () => {
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={5}
          onSelectAnswer={vi.fn()}
        />
      );

      expect(screen.getByText(/第 5 題/)).toBeInTheDocument();
    });

    it('應顯示四個選項', () => {
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          onSelectAnswer={vi.fn()}
        />
      );

      expect(screen.getByText(/二氧化碳/)).toBeInTheDocument();
      expect(screen.getByText(/氧氣/)).toBeInTheDocument();
      expect(screen.getByText(/氮氣/)).toBeInTheDocument();
      expect(screen.getByText(/氬氣/)).toBeInTheDocument();
    });

    it('應顯示選項代號 A/B/C/D', () => {
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          onSelectAnswer={vi.fn()}
        />
      );

      expect(screen.getByText('A')).toBeInTheDocument();
      expect(screen.getByText('B')).toBeInTheDocument();
      expect(screen.getByText('C')).toBeInTheDocument();
      expect(screen.getByText('D')).toBeInTheDocument();
    });
  });

  describe('選項互動', () => {
    it('點擊選項應觸發 onSelectAnswer', () => {
      const handleSelect = vi.fn();
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          onSelectAnswer={handleSelect}
        />
      );

      fireEvent.click(screen.getByText(/二氧化碳/));

      expect(handleSelect).toHaveBeenCalledWith('A');
    });

    it('選項應可透過鍵盤選擇', () => {
      const handleSelect = vi.fn();
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          onSelectAnswer={handleSelect}
        />
      );

      const optionA = screen.getByRole('radio', { name: /二氧化碳/ });
      fireEvent.keyDown(optionA, { key: 'Enter' });

      expect(handleSelect).toHaveBeenCalledWith('A');
    });
  });

  describe('已選擇狀態', () => {
    it('應標示已選擇的選項', () => {
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          selectedAnswer="B"
          onSelectAnswer={vi.fn()}
        />
      );

      const optionB = screen.getByRole('radio', { name: /氧氣/ });
      expect(optionB).toBeChecked();
    });
  });

  describe('答案顯示模式', () => {
    it('showAnswer 時應標示正確答案', () => {
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          selectedAnswer="B"
          showAnswer={true}
          onSelectAnswer={vi.fn()}
        />
      );

      // 正確答案（A）應有 correct 樣式
      const optionA = screen.getByTestId('option-A');
      expect(optionA).toHaveClass('correct');

      // 錯誤選擇（B）應有 incorrect 樣式
      const optionB = screen.getByTestId('option-B');
      expect(optionB).toHaveClass('incorrect');
    });

    it('showAnswer 後選項應為禁用狀態', () => {
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          selectedAnswer="A"
          showAnswer={true}
          onSelectAnswer={vi.fn()}
        />
      );

      const options = screen.getAllByRole('radio');
      options.forEach((option) => {
        expect(option).toBeDisabled();
      });
    });
  });

  describe('無答案題目', () => {
    const noAnswerQuestion: QuizQuestion = {
      ...mockQuestion,
      answer: null,
      hasAnswer: false,
    };

    it('無答案題目應顯示提示', () => {
      render(
        <QuestionCard
          question={noAnswerQuestion}
          questionNumber={1}
          showAnswer={true}
          onSelectAnswer={vi.fn()}
        />
      );

      expect(screen.getByText(/此題目無標準答案/)).toBeInTheDocument();
    });
  });

  describe('考科標籤', () => {
    it('應顯示考科分類', () => {
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          onSelectAnswer={vi.fn()}
        />
      );

      expect(screen.getByText(/考科一/)).toBeInTheDocument();
    });
  });

  describe('無障礙', () => {
    it('選項應有正確的 ARIA 屬性', () => {
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          onSelectAnswer={vi.fn()}
        />
      );

      const radioGroup = screen.getByRole('radiogroup');
      expect(radioGroup).toHaveAttribute('aria-labelledby');

      const options = screen.getAllByRole('radio');
      expect(options).toHaveLength(4);
    });
  });

  describe('作答歷史 chip（Refs #64）', () => {
    // 這些測試在 question-stats-storage 真實 mock 下跑
    // (test-setup 的 vi.fn() 預設會回 undefined → loadStats 視為空)
    it('未作答過的題目顯示「新題目」', () => {
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          onSelectAnswer={vi.fn()}
        />
      );
      expect(screen.getByTestId('question-stat-chip')).toHaveTextContent('新題目');
    });

    it('無標準答案題目（hasAnswer=false）不渲染 chip', () => {
      render(
        <QuestionCard
          question={{ ...mockQuestion, answer: null, hasAnswer: false }}
          questionNumber={1}
          onSelectAnswer={vi.fn()}
        />
      );
      expect(screen.queryByTestId('question-stat-chip')).not.toBeInTheDocument();
    });

    it('已有 stats 時顯示答對率 + 次數', () => {
      // 安裝 real localStorage 並寫入該題 stats
      const store = new Map<string, string>();
      store.set(
        'ipas-question-stats',
        JSON.stringify({
          version: 1,
          items: { [mockQuestion.id]: { attempts: 5, correct: 3, lastTriedAt: 0 } },
        })
      );
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

      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          onSelectAnswer={vi.fn()}
        />
      );
      const chip = screen.getByTestId('question-stat-chip');
      expect(chip).toHaveTextContent(/答對率\s*60%/);
      expect(chip).toHaveTextContent(/5 次/);
    });
  });
});

describe('QuestionCard 冗餘前綴 dim 化', () => {
  it('當所有選項共享題幹中的 prefix 時 → 渲染 dim span', () => {
    const griQuestion: QuizQuestion = {
      id: 'test-gri-67',
      stem: 'GRI 準則 2021 之系統架構分為三個系列準則，下列何者正確？',
      options: [
        { key: 'A', text: 'GRI 環境準則、GRI 社會準則、GRI 治理準則' },
        { key: 'B', text: 'GRI 環境準則、GRI 社會準則、GRI 經濟準則' },
        { key: 'C', text: 'GRI 通用準則、GRI 進階準則、GRI 特殊準則' },
        { key: 'D', text: 'GRI 通用準則、GRI 行業準則、GRI 主題準則' },
      ],
      answer: 'D',
      subject: '考科1',
      sourceType: 'gist',
      year: null,
      hasAnswer: true,
    };
    const { container } = render(
      <QuestionCard
        question={griQuestion}
        questionNumber={67}
        onSelectAnswer={vi.fn()}
      />
    );
    const dimSpans = container.querySelectorAll('.option-text__redundant');
    // 4 個選項都該有 dim 前綴
    expect(dimSpans.length).toBe(4);
    dimSpans.forEach((s) => expect(s.textContent).toBe('GRI'));
  });

  it('題幹未含共享 prefix 時 → 不 dim（避免誤殺）', () => {
    const noShareQuestion: QuizQuestion = {
      ...mockQuestion,
      // 題幹是溫室氣體，選項首字各不同，沒共享前綴
    };
    const { container } = render(
      <QuestionCard
        question={noShareQuestion}
        questionNumber={1}
        onSelectAnswer={vi.fn()}
      />
    );
    expect(container.querySelectorAll('.option-text__redundant').length).toBe(0);
  });
});
