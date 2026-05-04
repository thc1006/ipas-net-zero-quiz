import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { QuizQuestion } from '../../types/quiz';
import { BankSimilarQuestionItem } from './BankSimilarQuestionItem';

/** 模擬執行時 JSON／資料缺口導致 options 為 nullish（型別外） */
function questionWithoutOptions(): QuizQuestion {
  return {
    id: 'bad-opt-1',
    stem: '無選項資料題幹',
    options: undefined as unknown as QuizQuestion['options'],
    answer: 'A',
    subject: '考科1',
    sourceType: 'gist',
    hasAnswer: true,
  };
}

describe('BankSimilarQuestionItem', () => {
  it('options 為 undefined 時不崩潰並顯示 fallback UI', () => {
    render(<BankSimilarQuestionItem question={questionWithoutOptions()} index={1} />);
    expect(screen.getByText(/此題無選項資料/)).toBeInTheDocument();
    expect(screen.getByText(/無選項資料題幹/)).toBeInTheDocument();
  });

  it('options 為 null 時不崩潰並顯示 fallback', () => {
    const q = questionWithoutOptions();
    q.options = null as unknown as QuizQuestion['options'];
    render(<BankSimilarQuestionItem question={q} index={2} />);
    expect(screen.getByText(/此題無選項資料/)).toBeInTheDocument();
  });
});
