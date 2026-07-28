// QuizPage abort flow 測試（Refs #71）
// 焦點在 abort 按鈕 + confirm dialog 的互動行為
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuizPage } from './QuizPage';
import type { useQuiz } from '../hooks/useQuiz';

afterEach(cleanup);

/** Build a minimal mock quiz return matching useQuiz shape */
function makeQuizMock(
  overrides: Partial<ReturnType<typeof useQuiz>> = {}
): ReturnType<typeof useQuiz> {
  const fakeQuestion = {
    id: 'q-1',
    stem: '測試題目',
    options: [
      { key: 'A', text: '選項 A' },
      { key: 'B', text: '選項 B' },
      { key: 'C', text: '選項 C' },
      { key: 'D', text: '選項 D' },
    ],
    answer: 'A',
    subject: '考科1',
    section: 'fixture',
    explanation: '',
    sourceType: 'main_bank',
    hasAnswer: true,
  } as unknown as ReturnType<typeof useQuiz>['currentQuestion'];

  return {
    isActive: true,
    questions: [fakeQuestion as never],
    currentQuestion: fakeQuestion,
    currentIndex: 2,
    currentAnswer: null,
    progress: { current: 3, total: 10, answered: 2, percentage: 30 },
    config: {
      mode: 'practice',
      subject: 'all',
      questionCount: 10,
      shuffleQuestions: false,

      showAnswerImmediately: true,
    },
    isLastQuestion: false,
    isFirstQuestion: false,
    startQuiz: vi.fn(),
    startQuizWithPool: vi.fn(),
    submitAnswer: vi.fn(),
    nextQuestion: vi.fn(),
    prevQuestion: vi.fn(),
    goToQuestion: vi.fn(),
    finishQuiz: vi.fn(),
    resetQuiz: vi.fn(),
    resumeQuiz: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useQuiz>;
}

describe('QuizPage — abort flow (#71)', () => {
  it('顯示「結束並返回首頁」按鈕在進度條同行', () => {
    render(<QuizPage quiz={makeQuizMock()} onFinish={vi.fn()} onAbort={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /結束並返回首頁/ });
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toMatch(/結束並返回首頁/);
  });

  it('預設不顯示 confirm dialog', () => {
    render(<QuizPage quiz={makeQuizMock()} onFinish={vi.fn()} onAbort={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('點擊結束按鈕彈出 confirm dialog 含進度資訊', () => {
    render(
      <QuizPage
        quiz={makeQuizMock({
          progress: { current: 3, total: 10, answered: 5, percentage: 30 },
        })}
        onFinish={vi.fn()}
        onAbort={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /結束並返回首頁/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // 顯示進度
    expect(dialog.textContent).toMatch(/已答 5 \/ 10 題/);
    // 提示進度會保留
    expect(dialog.textContent).toMatch(/進度會自動保留/);
  });

  it('confirm dialog 點「結束並返回」呼叫 onAbort', () => {
    const onAbort = vi.fn();
    render(<QuizPage quiz={makeQuizMock()} onFinish={vi.fn()} onAbort={onAbort} />);
    fireEvent.click(screen.getByRole('button', { name: /結束並返回首頁/ }));
    // dialog 內 confirm 按鈕純文字「結束並返回」（不含「首頁」），用 exact regex 避免
    // 與外層 abort 按鈕「結束並返回首頁」（substring contains 結束並返回）撞名
    fireEvent.click(screen.getByRole('button', { name: /^結束並返回$/ }));
    expect(onAbort).toHaveBeenCalledOnce();
  });

  it('confirm dialog 點「取消」關閉但不 abort', () => {
    const onAbort = vi.fn();
    render(<QuizPage quiz={makeQuizMock()} onFinish={vi.fn()} onAbort={onAbort} />);
    fireEvent.click(screen.getByRole('button', { name: /結束並返回首頁/ }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onAbort).not.toHaveBeenCalled();
  });

  it('ESC 關閉 confirm dialog（a11y）', () => {
    const onAbort = vi.fn();
    render(<QuizPage quiz={makeQuizMock()} onFinish={vi.fn()} onAbort={onAbort} />);
    fireEvent.click(screen.getByRole('button', { name: /結束並返回首頁/ }));
    expect(screen.queryByRole('dialog')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onAbort).not.toHaveBeenCalled();
  });

  it('點擊 dialog overlay（外部）關閉 dialog', () => {
    const onAbort = vi.fn();
    render(<QuizPage quiz={makeQuizMock()} onFinish={vi.fn()} onAbort={onAbort} />);
    fireEvent.click(screen.getByRole('button', { name: /結束並返回首頁/ }));
    const overlay = document.querySelector('.quiz-abort-dialog-overlay');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay as Element);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onAbort).not.toHaveBeenCalled();
  });

  it('點擊 dialog 內容區（不是 overlay）不關閉 dialog（避免誤觸）', () => {
    render(<QuizPage quiz={makeQuizMock()} onFinish={vi.fn()} onAbort={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /結束並返回首頁/ }));
    const inner = document.querySelector('.quiz-abort-dialog');
    expect(inner).not.toBeNull();
    fireEvent.click(inner as Element);
    // dialog 仍存在
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });
});

// 計分競態修正（回報：正確 30＋錯誤 19＝49，總題數 50 —— 少算一題）
//
// 根因：考試模式（showAnswerImmediately=false）原本把 submitAnswer 延到 handleNext 才呼叫，
// 而「最後一題」的 handleNext 是「submitAnswer（非同步 setState）→ 立刻 onFinish→finishQuiz」，
// finishQuiz 讀到的是還沒含最後一筆的舊 state closure → 最後一題被吞掉。
// 修正：兩種模式都改成「選擇答案當下」就 submitAnswer，該 setState 早在按「完成測驗」前的
// 另一個 render 就 flush，徹底消除競態。這兩條測試把「選擇即記錄」與「完成不再重複 submit」釘住。
describe('QuizPage — 計分競態修正（考試模式選擇答案即記錄）', () => {
  const examConfig = {
    mode: 'exam' as const,
    subject: 'all' as const,
    questionCount: 3,
    shuffleQuestions: false,
    showAnswerImmediately: false,
  };

  it('考試模式：點選選項當下即呼叫 submitAnswer（不再延到 handleNext）', () => {
    const submitAnswer = vi.fn();
    render(
      <QuizPage
        quiz={makeQuizMock({ submitAnswer, config: examConfig })}
        onFinish={vi.fn()}
        onAbort={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('radio', { name: 'A: 選項 A' }));
    expect(submitAnswer).toHaveBeenCalledWith('A');
  });

  it('考試模式最後一題：submitAnswer 已於選擇時呼叫；「完成測驗」只 onFinish、不再 submit', () => {
    const submitAnswer = vi.fn();
    const onFinish = vi.fn();
    render(
      <QuizPage
        quiz={makeQuizMock({ submitAnswer, isLastQuestion: true, config: examConfig })}
        onFinish={onFinish}
        onAbort={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('radio', { name: 'A: 選項 A' }));
    expect(submitAnswer).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /完成測驗/ }));
    expect(onFinish).toHaveBeenCalledOnce();
    // 關鍵：完成測驗沒有再 submit 一次（舊碼正是在此 submitAnswer→onFinish 造成競態）
    expect(submitAnswer).toHaveBeenCalledTimes(1);
  });
});
