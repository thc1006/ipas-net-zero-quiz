// 結果頁錯題卡上的星號與移出待複習；再測一次沒有題目時的說明
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ResultPage } from './ResultPage';
import {
  REVIEW_STORAGE_KEY,
  __resetReviewStoreForTesting,
  getReviewSnapshot,
  isStarred,
  wrongEntry,
} from '../utils/review-storage';
import { installRealLocalStorage } from '../utils/__fixtures__/real-local-storage';
import type { AnswerRecord, QuizQuestion, QuizResult } from '../types/quiz';

vi.mock('../utils/ai-helper', () => ({
  explainQuestionStream: vi.fn(),
  generateSimilarQuestionStream: vi.fn(),
}));

const question: QuizQuestion = {
  id: 'q1',
  stem: '題幹',
  options: [
    { key: 'A', text: '甲' },
    { key: 'B', text: '乙' },
  ],
  answer: 'A',
  subject: '考科1',
  sourceType: 'gist',
  year: null,
  hasAnswer: true,
};

const answer: AnswerRecord = {
  questionId: 'q1',
  selectedAnswer: 'B',
  correctAnswer: 'A',
  isCorrect: false,
  timeSpent: 1,
  timestamp: 1,
  sourceCategory: 'main_bank',
};

const result: QuizResult = {
  config: { mode: 'exam', subject: 'all', questionCount: 1, shuffleQuestions: false, showAnswerImmediately: false },
  startTime: 0,
  endTime: 1,
  totalTime: 1,
  answers: [answer],
  questions: [question],
  score: 0,
  totalAnswerable: 1,
  correctCount: 0,
  wrongCount: 1,
  skippedCount: 0,
};

let store: Map<string, string>;
const put = (stars: object, wrong: object) =>
  store.set(REVIEW_STORAGE_KEY, JSON.stringify({ v: 1, seeded: true, stars, wrong }));
const card = () => screen.getByRole('article');

beforeEach(() => {
  store = installRealLocalStorage();
  __resetReviewStoreForTesting();
});

afterEach(cleanup);

const renderPage = (retryNotice?: string | null) =>
  render(<ResultPage result={result} onGoHome={() => {}} onRetry={() => {}} retryNotice={retryNotice} />);

describe('結果頁', () => {
  it('錯題卡上有星號；按下去存起來', () => {
    renderPage();
    fireEvent.click(within(card()).getByRole('button', { name: '第 1 題加星號' }));
    expect(isStarred(getReviewSnapshot(), 'q1')).toBe(true);
  });

  it('在待複習裡：有移出按鈕，按下去移出，星號不動', () => {
    put({ q1: 1 }, { q1: { streak: 0, last: 1 } });
    renderPage();
    fireEvent.click(within(card()).getByRole('button', { name: '移出待複習' }));
    expect(wrongEntry(getReviewSnapshot(), 'q1')).toBeUndefined();
    expect(isStarred(getReviewSnapshot(), 'q1')).toBe(true);
    expect(within(card()).getByText('已移出待複習')).toBeInTheDocument();
  });

  it('連續答對 1 次時顯示進度', () => {
    put({}, { q1: { streak: 1, last: 1 } });
    renderPage();
    expect(within(card()).getByText('再答對 1 次移出')).toBeInTheDocument();
  });

  it('不在待複習裡：沒有移出按鈕', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: '移出待複習' })).toBeNull();
  });

  it('星號的名稱含題號：結果頁有好幾顆，念出來要分得出是哪一題', () => {
    const second: AnswerRecord = { ...answer, questionId: 'q2' };
    render(
      <ResultPage
        result={{ ...result, answers: [answer, second], questions: [question, { ...question, id: 'q2' }] }}
        onGoHome={() => {}}
        onRetry={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: '第 1 題加星號' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '第 2 題加星號' })).toBeInTheDocument();
  });

  it('摘要：這場有幾題進待複習、幾題移出', () => {
    render(
      <ResultPage result={{ ...result, reviewSummary: { added: 3, removed: 2 } }} onGoHome={() => {}} onRetry={() => {}} />
    );
    expect(screen.getByText('這場有 3 題進待複習、2 題移出。')).toBeInTheDocument();
  });

  it('摘要只寫有變動的那一項', () => {
    const { rerender } = render(
      <ResultPage result={{ ...result, reviewSummary: { added: 1, removed: 0 } }} onGoHome={() => {}} onRetry={() => {}} />
    );
    expect(screen.getByText('這場有 1 題進待複習。')).toBeInTheDocument();
    rerender(
      <ResultPage result={{ ...result, reviewSummary: { added: 0, removed: 4 } }} onGoHome={() => {}} onRetry={() => {}} />
    );
    expect(screen.getByText('這場有 4 題移出。')).toBeInTheDocument();
  });

  it('沒有變動、寫入失敗、舊的結果都沒有摘要', () => {
    for (const reviewSummary of [{ added: 0, removed: 0 }, null, undefined]) {
      render(<ResultPage result={{ ...result, reviewSummary }} onGoHome={() => {}} onRetry={() => {}} />);
      expect(screen.queryByText(/^這場有/)).toBeNull();
      cleanup();
    }
  });

  it('錯題區說明去哪裡練：答錯的題目真的在清單上才說', () => {
    renderPage();
    expect(screen.queryByText(/已進待複習/)).toBeNull();
    cleanup();
    put({}, { q1: { streak: 0, last: 1 } });
    renderPage();
    expect(screen.getByText('答錯的題目已進待複習，首頁「題目來源」選「待複習錯題」可以練。')).toBeInTheDocument();
  });

  it('再測一次的說明放在 live region：平常是空的，有內容時念得出來', () => {
    const { rerender } = renderPage();
    const region = document.querySelector('.action-notice')!;
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveTextContent('');
    rerender(<ResultPage result={result} onGoHome={() => {}} onRetry={() => {}} retryNotice="沒有題目" />);
    expect(document.querySelector('.action-notice')).toBe(region);
    expect(region).toHaveTextContent('沒有題目');
  });
});
