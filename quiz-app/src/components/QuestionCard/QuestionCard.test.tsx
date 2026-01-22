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
});
