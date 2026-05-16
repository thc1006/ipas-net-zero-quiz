import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

/** 完整可作答的題庫相似題 */
function makeQuestion(overrides: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    id: 'sim-1',
    stem: '下列何者屬於再生能源？',
    options: [
      { key: 'A', text: '燃煤' },
      { key: 'B', text: '太陽能' },
      { key: 'C', text: '天然氣' },
      { key: 'D', text: '核能' },
    ],
    answer: 'B',
    subject: '考科1',
    sourceType: 'gist',
    hasAnswer: true,
    ...overrides,
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

  it('渲染題幹、序號與所有選項，作答前不顯示揭曉區', () => {
    render(<BankSimilarQuestionItem question={makeQuestion()} index={3} />);
    expect(screen.getByText('3.')).toBeInTheDocument();
    expect(screen.getByText(/下列何者屬於再生能源/)).toBeInTheDocument();
    (['A', 'B', 'C', 'D'] as const).forEach((k) => {
      expect(screen.getByTestId(`bank-similar-option-${k}`)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('bank-similar-reveal')).not.toBeInTheDocument();
  });

  it('選到正解 → 揭曉顯示「答對了」並禁用所有選項', () => {
    render(<BankSimilarQuestionItem question={makeQuestion()} index={1} />);
    fireEvent.click(screen.getByTestId('bank-similar-option-B'));

    const reveal = screen.getByTestId('bank-similar-reveal');
    expect(within(reveal).getByText(/正確答案/)).toBeInTheDocument();
    expect(within(reveal).getByText(/答對了/)).toBeInTheDocument();
    expect(screen.getByTestId('bank-similar-option-B').className).toMatch(/correct/);
    screen.getAllByRole('radio').forEach((r) => expect(r).toBeDisabled());
  });

  it('選到錯誤選項 → 顯示正解與「您選擇了」，錯選標記 incorrect', () => {
    render(<BankSimilarQuestionItem question={makeQuestion()} index={1} />);
    fireEvent.click(screen.getByTestId('bank-similar-option-A'));

    const reveal = screen.getByTestId('bank-similar-reveal');
    expect(within(reveal).getByText(/您選擇了 A/)).toBeInTheDocument();
    expect(screen.getByTestId('bank-similar-option-A').className).toMatch(/incorrect/);
    expect(screen.getByTestId('bank-similar-option-B').className).toMatch(/correct/);
  });

  it('題庫未標示標準答案（hasAnswer=false）→ 揭曉僅回放使用者選擇', () => {
    render(
      <BankSimilarQuestionItem
        question={makeQuestion({ hasAnswer: false, answer: null })}
        index={1}
      />
    );
    fireEvent.click(screen.getByTestId('bank-similar-option-C'));

    const reveal = screen.getByTestId('bank-similar-reveal');
    expect(within(reveal).getByText(/未標示標準答案/)).toBeInTheDocument();
    expect(within(reveal).getByText('C')).toBeInTheDocument();
    // 沒有標準答案時不應標出 correct
    expect(screen.getByTestId('bank-similar-option-C').className).not.toMatch(/correct/);
  });

  it('鍵盤 Enter 可選取選項並觸發揭曉', () => {
    render(<BankSimilarQuestionItem question={makeQuestion()} index={1} />);
    const radioB = within(screen.getByTestId('bank-similar-option-B')).getByRole('radio');
    fireEvent.keyDown(radioB, { key: 'Enter' });
    expect(screen.getByTestId('bank-similar-reveal')).toBeInTheDocument();
  });

  it('考科2 題目顯示「考科二」標籤', () => {
    render(
      <BankSimilarQuestionItem question={makeQuestion({ subject: '考科2' })} index={1} />
    );
    expect(screen.getByText('考科二')).toBeInTheDocument();
  });
});
