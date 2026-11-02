// 作答中按星號：不能清掉選的答案、不能搶走焦點、題卡不能重新掛載（AnkiDroid 就是這樣把選項重設掉）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuizPage } from './QuizPage';
import { useQuiz } from '../hooks/useQuiz';
import { allQuestions } from '../data/questions';
import { isQuestionScorable } from '../utils/scorable';
import { __resetReviewStoreForTesting, setStar } from '../utils/review-storage';
import { installRealLocalStorage } from '../utils/__fixtures__/real-local-storage';

const mode = vi.hoisted(() => ({ value: 'practice' as 'practice' | 'exam' }));

function Harness() {
  const quiz = useQuiz();
  if (!quiz.currentQuestion) {
    return (
      <button
        type="button"
        onClick={() =>
          quiz.startQuiz({
            mode: mode.value,
            subject: 'all',
            questionCount: 2,
            shuffleQuestions: false,
            showAnswerImmediately: mode.value === 'practice',
          })
        }
      >
        開始
      </button>
    );
  }
  return <QuizPage quiz={quiz} onFinish={() => {}} onAbort={() => {}} />;
}

const star = () => screen.getByRole('button', { name: '加星號' });
const firstQuestion = allQuestions.filter((q) => isQuestionScorable(q))[0];

beforeEach(() => {
  installRealLocalStorage();
  __resetReviewStoreForTesting();
});

afterEach(cleanup);

describe.each(['practice', 'exam'] as const)('作答中按星號（%s）', (m) => {
  beforeEach(() => {
    mode.value = m;
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '開始' }));
  });

  it('選的答案還在、焦點還在星號上、題卡沒有重新掛載', () => {
    const radio = screen.getByRole('radio', { name: new RegExp(String.raw`^${firstQuestion.options[1].key}:`) });
    fireEvent.click(radio);
    expect(radio).toBeChecked();

    const card = document.querySelector('.question-card');
    star().focus();
    fireEvent.click(star());
    expect(star()).toHaveAttribute('aria-pressed', 'true');
    expect(star()).toHaveFocus();
    expect(document.querySelector('.question-card')).toBe(card);
    expect(screen.getByRole('radio', { name: new RegExp(String.raw`^${firstQuestion.options[1].key}:`) })).toBeChecked();

    fireEvent.click(star());
    expect(star()).toHaveFocus();
    expect(document.querySelector('.question-card')).toBe(card);
  });

  it('別的分頁或別的元件改了星號：題卡一樣不重新掛載', () => {
    const card = document.querySelector('.question-card');
    act(() => {
      setStar(firstQuestion.id, true);
    });
    expect(document.querySelector('.question-card')).toBe(card);
    expect(star()).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('換題之後星號跟著題目走', () => {
  it('下一題是自己的狀態，回上一題還是加過的', () => {
    mode.value = 'practice';
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '開始' }));
    fireEvent.click(star());
    fireEvent.click(screen.getByRole('button', { name: /下一題/ }));
    expect(star()).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: /上一題/ }));
    expect(star()).toHaveAttribute('aria-pressed', 'true');
  });
});
