// 考試模式端對端計分回歸測試 —— 回報「正確 30＋錯誤 19＝49、總題數 50」（少算最後一題）。
//
// 根因是 QuizPage↔useQuiz 的 render 競態：考試模式原本把 submitAnswer 延到 handleNext，
// 而最後一題的 handleNext 會「submitAnswer（非同步 setState）→ 立刻 onFinish→finishQuiz」，
// finishQuiz 讀到還沒含最後一筆的舊 state。單獨測 hook 抓不到（競態在整合層），
// 因此這裡用真實 useQuiz + QuizPage 串起 startQuiz → 逐題作答 → finishQuiz，驗證計分不漏。
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { useQuiz } from '../hooks/useQuiz';
import { QuizPage } from './QuizPage';
import type { QuizConfig, QuizResult } from '../types/quiz';

afterEach(cleanup);

function ExamHarness({
  config,
  onResult,
}: {
  config: QuizConfig;
  onResult: (r: QuizResult | null) => void;
}) {
  const quiz = useQuiz();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    quiz.startQuiz(config);
  }, [quiz, config]);

  if (!quiz.isActive) return null;
  return (
    <QuizPage
      quiz={quiz}
      onFinish={() => onResult(quiz.finishQuiz())}
      onAbort={() => {}}
    />
  );
}

describe('考試模式端對端計分：最後一題不會被吞', () => {
  it('跑完整份考試，correct + wrong 等於總題數（不少算最後一題）', () => {
    const N = 3;
    let result: QuizResult | null = null;
    const config: QuizConfig = {
      mode: 'exam',
      subject: '考科1',
      questionCount: N,
      shuffleQuestions: false, // 決定性取題
      showAnswerImmediately: false, // 考試模式 —— 競態就在這條路徑上
    };

    render(<ExamHarness config={config} onResult={(r) => (result = r)} />);

    // 逐題：選第一個選項（A），再按「下一題」/最後一題按「完成測驗」
    for (let i = 0; i < N; i++) {
      const radios = screen.getAllByRole('radio');
      expect(radios.length).toBeGreaterThanOrEqual(2); // 該題確實有選項
      fireEvent.click(radios[0]);
      const isLast = i === N - 1;
      fireEvent.click(
        screen.getByRole('button', { name: isLast ? /完成測驗/ : /下一題/ })
      );
    }

    expect(result).not.toBeNull();
    const r = result as unknown as QuizResult;
    expect(r.totalAnswerable).toBe(N);
    // 核心斷言：N 題全部計入（最後一題沒被競態吞掉）。修正前這裡會是 N-1。
    expect(r.correctCount + r.wrongCount).toBe(N);
    expect(r.skippedCount).toBe(0);
  });
});
