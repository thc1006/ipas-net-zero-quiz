// 題卡上的星號與移出待複習：兩種模式都有星號，什麼都不洩漏；答案揭曉之前看不出這題在待複習裡
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QuestionCard } from './QuestionCard';
import { REVIEW_STORAGE_KEY, __resetReviewStoreForTesting } from '../../utils/review-storage';
import { installRealLocalStorage } from '../../utils/__fixtures__/real-local-storage';
import type { QuizQuestion } from '../../types/quiz';

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

let store: Map<string, string>;
const inWrong = (streak: number) =>
  store.set(
    REVIEW_STORAGE_KEY,
    JSON.stringify({ v: 1, seeded: true, stars: {}, wrong: { q1: { streak, last: 1 } } })
  );

const renderCard = (showAnswer: boolean, selectedAnswer = 'B') =>
  render(
    <QuestionCard
      question={question}
      questionNumber={1}
      selectedAnswer={showAnswer ? selectedAnswer : null}
      showAnswer={showAnswer}
      onSelectAnswer={() => {}}
    />
  );

beforeEach(() => {
  store = installRealLocalStorage();
  __resetReviewStoreForTesting();
});

afterEach(cleanup);

describe('題卡', () => {
  it('星號在標頭：答案揭曉前後都有', () => {
    renderCard(false);
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('button', { name: '加星號' })).toBeInTheDocument();
    cleanup();
    renderCard(true);
    expect(within(screen.getByRole('banner')).getByRole('button', { name: '加星號' })).toBeInTheDocument();
  });

  it('答案揭曉前（考試模式整場都是）：就算在待複習裡，也不顯示按鈕與進度', () => {
    inWrong(1);
    renderCard(false);
    expect(screen.queryByRole('button', { name: '移出待複習' })).toBeNull();
    expect(screen.queryByText(/再答對/)).toBeNull();
  });

  it('答案揭曉後：在待複習裡就有移出按鈕，依這次的對錯說還差幾次', () => {
    inWrong(1);
    renderCard(true);
    expect(screen.getByRole('button', { name: '移出待複習' })).toBeInTheDocument();
    expect(screen.getByText('要連續答對 2 次')).toBeInTheDocument();
    cleanup();
    renderCard(true, 'A');
    expect(screen.getByText('這場結束會移出')).toBeInTheDocument();
    cleanup();
    inWrong(0);
    renderCard(true, 'A');
    expect(screen.getByText('再答對 1 次移出')).toBeInTheDocument();
  });

  it('答案揭曉後：不在待複習裡就沒有', () => {
    renderCard(true);
    expect(screen.queryByRole('button', { name: '移出待複習' })).toBeNull();
  });
});
