// QuizPage abort flow 測試（Refs #71）
// 焦點在 abort 按鈕 + confirm dialog 的互動行為
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QuizPage } from './QuizPage';
import type { useQuiz } from '../hooks/useQuiz';

const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView);

beforeEach(() => scrollIntoView.mockReset());
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

  it('練習模式：方向鍵不記錄作答，Enter 才記錄，焦點移到下一題', () => {
    const submitAnswer = vi.fn();
    render(<QuizPage quiz={makeQuizMock({ submitAnswer })} onFinish={vi.fn()} onAbort={vi.fn()} />);
    const radios = screen.getAllByRole('radio');
    radios[0].focus();

    fireEvent.keyDown(radios[0], { key: 'ArrowDown' });
    expect(submitAnswer).not.toHaveBeenCalled();

    fireEvent.keyDown(radios[1], { key: 'Enter' });
    expect(submitAnswer).toHaveBeenCalledExactlyOnceWith('B');
    expect(screen.getByRole('button', { name: /下一題/ })).toHaveFocus();
  });

  it('練習模式：解析畫出來之後才把導覽列捲進視窗，捲動量取最小', () => {
    render(<QuizPage quiz={makeQuizMock()} onFinish={vi.fn()} onAbort={vi.fn()} />);
    const radios = screen.getAllByRole('radio');
    radios[0].focus();
    const feedbackAtScroll: (Element | null)[] = [];
    scrollIntoView.mockImplementation(() => feedbackAtScroll.push(document.querySelector('.ai-section')));

    fireEvent.keyDown(radios[0], { key: 'Enter' });

    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' });
    expect(scrollIntoView.mock.contexts[0]).toBe(document.querySelector('.quiz-navigation'));
    expect(feedbackAtScroll[0]).not.toBeNull();
  });

  const outcome = () => within(document.querySelector('.nav-center') as HTMLElement).getByRole('status');

  it.each([
    ['A', 0, '答對了'],
    ['B', 1, '答錯了，正確答案是 A'],
  ])('練習模式：鍵盤選 %s，對錯看得見也念得出來，放在下一題旁邊', (_key, index, text) => {
    render(<QuizPage quiz={makeQuizMock()} onFinish={vi.fn()} onAbort={vi.fn()} />);
    const radio = screen.getAllByRole('radio')[index];
    radio.focus();

    fireEvent.keyDown(radio, { key: 'Enter' });

    expect(outcome()).toHaveTextContent(text);
    expect(outcome()).toHaveClass('answer-outcome');
  });

  it('練習模式：滑鼠作答只念給螢幕閱讀器，畫面上不多一行', () => {
    render(<QuizPage quiz={makeQuizMock()} onFinish={vi.fn()} onAbort={vi.fn()} />);

    fireEvent.click(screen.getByRole('radio', { name: /選項 B/ }));

    expect(outcome()).toHaveTextContent('答錯了，正確答案是 A');
    expect(outcome()).toHaveClass('sr-only');
  });

  it('練習模式：對錯只有一個 status，選項卡裡不再念一次', () => {
    render(<QuizPage quiz={makeQuizMock()} onFinish={vi.fn()} onAbort={vi.fn()} />);

    fireEvent.click(screen.getByRole('radio', { name: /選項 A/ }));

    const texts = screen.getAllByRole('status').map((el) => el.textContent);
    expect(texts.filter((t) => t?.includes('答對了'))).toHaveLength(1);
  });

  it('換題之後對錯清空：Q1 鍵盤、Q2 滑鼠，第二題焦點不跳也不會顯示出來', () => {
    const quiz = makeQuizMock();
    const second = { ...quiz.currentQuestion!, id: 'q-2', stem: '第二題' };
    const { rerender } = render(<QuizPage quiz={quiz} onFinish={vi.fn()} onAbort={vi.fn()} />);
    const radios = screen.getAllByRole('radio');
    radios[0].focus();
    fireEvent.keyDown(radios[0], { key: 'Enter' });
    const next = screen.getByRole('button', { name: /下一題/ });
    expect(next).toHaveFocus();

    rerender(<QuizPage quiz={{ ...quiz, currentQuestion: second }} onFinish={vi.fn()} onAbort={vi.fn()} />);
    expect(outcome()).toBeEmptyDOMElement();
    act(() => next.blur());

    fireEvent.click(screen.getByRole('radio', { name: /選項 A/ }));

    expect(next).not.toHaveFocus();
    expect(outcome()).toHaveClass('sr-only');
  });

  it('練習模式：鍵盤按下一題，焦點移到新題幹並捲到它；滑鼠按照舊', () => {
    const quiz = makeQuizMock();
    const second = { ...quiz.currentQuestion!, id: 'q-2', stem: '第二題' };
    const { rerender } = render(<QuizPage quiz={quiz} onFinish={vi.fn()} onAbort={vi.fn()} />);
    const next = screen.getByRole('button', { name: /下一題/ });

    fireEvent.click(next, { detail: 1 });
    rerender(<QuizPage quiz={{ ...quiz, currentQuestion: second }} onFinish={vi.fn()} onAbort={vi.fn()} />);
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(next, { detail: 0 });
    rerender(<QuizPage quiz={quiz} onFinish={vi.fn()} onAbort={vi.fn()} />);

    expect(document.querySelector('.question-stem')).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'start' });
    expect(scrollIntoView.mock.contexts[0]).toBe(document.querySelector('.question-stem'));
  });

  it('考試模式：鍵盤按下一題，焦點不動', () => {
    const quiz = makeQuizMock({
      config: {
        mode: 'exam',
        subject: 'all',
        questionCount: 10,
        shuffleQuestions: false,
        showAnswerImmediately: false,
      },
    });
    const second = { ...quiz.currentQuestion!, id: 'q-2', stem: '第二題' };
    const { rerender } = render(<QuizPage quiz={quiz} onFinish={vi.fn()} onAbort={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: /選項 A/ }));

    fireEvent.click(screen.getByRole('button', { name: /下一題/ }), { detail: 0 });
    rerender(<QuizPage quiz={{ ...quiz, currentQuestion: second }} onFinish={vi.fn()} onAbort={vi.fn()} />);

    expect(document.querySelector('.question-stem')).not.toHaveFocus();
    expect(document.querySelector('.nav-center [role="status"]')).toBeNull();
  });

  it('練習模式：最後一題作答後焦點落在完成測驗', () => {
    render(
      <QuizPage quiz={makeQuizMock({ isLastQuestion: true })} onFinish={vi.fn()} onAbort={vi.fn()} />
    );
    const radios = screen.getAllByRole('radio');
    radios[0].focus();

    fireEvent.keyDown(radios[0], { key: ' ' });

    expect(screen.getByRole('button', { name: /完成測驗/ })).toHaveFocus();
  });

  it('練習模式：點選項照舊，焦點不移到下一題', () => {
    render(<QuizPage quiz={makeQuizMock()} onFinish={vi.fn()} onAbort={vi.fn()} />);

    fireEvent.click(screen.getByRole('radio', { name: /選項 B/ }));

    expect(screen.getByRole('button', { name: /下一題/ })).not.toHaveFocus();
  });

  it('練習模式：按住按鍵的重複事件不算按下一題，第一下照常', () => {
    render(<QuizPage quiz={makeQuizMock()} onFinish={vi.fn()} onAbort={vi.fn()} />);
    const next = screen.getByRole('button', { name: /下一題/ });

    expect(fireEvent.keyDown(next, { key: 'Enter', repeat: true })).toBe(false);
    expect(fireEvent.keyDown(next, { key: 'Enter' })).toBe(true);
  });

  it('考試模式：Enter 記錄作答但焦點留在選項，按住按鍵也不攔', () => {
    const submitAnswer = vi.fn();
    const config = {
      mode: 'exam',
      subject: 'all',
      questionCount: 10,
      shuffleQuestions: false,
      showAnswerImmediately: false,
    } as const;
    render(<QuizPage quiz={makeQuizMock({ submitAnswer, config })} onFinish={vi.fn()} onAbort={vi.fn()} />);
    const radios = screen.getAllByRole('radio');
    radios[0].focus();

    expect(fireEvent.keyDown(radios[0], { key: 'ArrowDown' })).toBe(true);
    expect(submitAnswer).not.toHaveBeenCalled(); // jsdom 沒有 radio 的預設行為，真實改答案在 E2E

    fireEvent.keyDown(radios[0], { key: 'Enter' });
    expect(submitAnswer).toHaveBeenCalledExactlyOnceWith('A');
    expect(radios[0]).toHaveFocus();

    const next = screen.getByRole('button', { name: /下一題/ });
    expect(fireEvent.keyDown(next, { key: 'Enter', repeat: true })).toBe(true);
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

  it('練習模式：選擇答案即 submitAnswer 並顯示答案（hasAnswered 分支）', () => {
    const submitAnswer = vi.fn();
    render(
      <QuizPage
        quiz={makeQuizMock({
          submitAnswer,
          config: {
            mode: 'practice',
            subject: 'all',
            questionCount: 3,
            shuffleQuestions: false,
            showAnswerImmediately: true,
          },
        })}
        onFinish={vi.fn()}
        onAbort={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('radio', { name: 'A: 選項 A' }));
    expect(submitAnswer).toHaveBeenCalledWith('A');
    // showAnswerImmediately → setHasAnswered(true) → 顯示答案，正確選項標記出現
    expect(screen.getByLabelText('正確答案')).toBeInTheDocument();
  });
});

// 導覽時依既有作答紀錄還原選取狀態（修正「選擇即記錄」後回到已答題顯示未選、
// 考試模式按鈕被卡住的互動不一致；同時修好過去「返回上一題丟失選取」的既有缺口）
describe('QuizPage — 導覽依紀錄還原選取狀態', () => {
  it('切換到已作答題：依紀錄還原選取，考試模式按鈕不再被卡住', () => {
    render(
      <QuizPage
        quiz={makeQuizMock({
          currentAnswer: {
            questionId: 'q-1',
            selectedAnswer: 'B',
            correctAnswer: 'A',
            isCorrect: false,
            timeSpent: 1,
            timestamp: 0,
            sourceCategory: 'main_bank',
          },
          config: {
            mode: 'exam',
            subject: 'all',
            questionCount: 3,
            shuffleQuestions: false,
            showAnswerImmediately: false,
          },
        })}
        onFinish={vi.fn()}
        onAbort={vi.fn()}
      />
    );
    // layout effect 依紀錄還原 → 選項 B 呈已選
    expect(screen.getByRole('radio', { name: 'B: 選項 B' })).toBeChecked();
    // 考試模式「下一題」不再 disabled（selectedAnswer 已還原）
    expect(screen.getByRole('button', { name: /下一題/ })).toBeEnabled();
  });

  it('點「上一題」呼叫 prevQuestion', () => {
    const prevQuestion = vi.fn();
    render(
      <QuizPage
        quiz={makeQuizMock({ prevQuestion, isFirstQuestion: false })}
        onFinish={vi.fn()}
        onAbort={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /上一題/ }));
    expect(prevQuestion).toHaveBeenCalledOnce();
  });
});
