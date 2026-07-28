// 測驗頁面元件
import { useState, useCallback, useEffect, useLayoutEffect } from 'react';
import { QuestionCard } from '../components/QuestionCard';
import type { useQuiz } from '../hooks/useQuiz';
import './QuizPage.css';

interface QuizPageProps {
  quiz: ReturnType<typeof useQuiz>;
  onFinish: () => void;
  /** 使用者點「結束並返回首頁」時呼叫；保留進度供下次 resume（Refs #71） */
  onAbort: () => void;
}

export function QuizPage({ quiz, onFinish, onAbort }: QuizPageProps) {
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [hasAnswered, setHasAnswered] = useState(false);
  const [abortConfirmOpen, setAbortConfirmOpen] = useState(false);

  // ESC 關閉 abort confirm dialog（a11y 期待行為）
  useEffect(() => {
    if (!abortConfirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbortConfirmOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [abortConfirmOpen]);

  const {
    currentQuestion,
    currentIndex,
    currentAnswer,
    progress,
    config,
    isLastQuestion,
    isFirstQuestion,
    submitAnswer,
    nextQuestion,
    prevQuestion,
  } = quiz;

  // 切換題目時（返回上一題、續作還原、以及「選擇即記錄」後的導覽），從既有作答紀錄
  // 還原 UI 的選取／已答狀態。若不還原：回到已答題會顯示未選，考試模式還會因
  // `!selectedAnswer` 而卡住「下一題／完成測驗」按鈕，逼使用者重答（且重答會覆蓋原紀錄）。
  // 用 layout effect 在 paint 前完成，避免切題瞬間閃一下上一題的選取。
  // 僅在「題目切換」時還原 —— 同題內 submitAnswer 造成的 currentAnswer 變動不重觸發。
  useLayoutEffect(() => {
    const prior = currentAnswer?.selectedAnswer ?? null;
    setSelectedAnswer(prior);
    setHasAnswered(prior !== null && !!config?.showAnswerImmediately);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestion?.id]);

  // 選擇答案
  const handleSelectAnswer = useCallback(
    (answer: string) => {
      if (hasAnswered && config?.showAnswerImmediately) return;

      setSelectedAnswer(answer);

      // 一律在「選擇當下」就記錄作答 —— 兩種模式皆同（submitAnswer 依 questionId 去重，
      // 重選會覆蓋而非追加）。
      //
      // 過去只有 showAnswerImmediately（練習）模式在此記錄；考試模式延到 handleNext 才
      // submitAnswer，而**最後一題**的 handleNext 是「submitAnswer（非同步 setState）後**立刻**
      // onFinish」—— finishQuiz 讀到的是還沒含最後一筆的舊 state closure，最後一題被吞掉，
      // 計分永遠少一題（回報：正確 30＋錯誤 19＝49，總題數 50）。
      // 改成選擇即記錄，該筆 setState 早在使用者按「完成測驗」前的另一個 render 就已 flush，
      // 徹底消除這個競態。
      submitAnswer(answer);

      if (config?.showAnswerImmediately) {
        setHasAnswered(true);
      }
    },
    [hasAnswered, config?.showAnswerImmediately, submitAnswer]
  );

  // 下一題（作答已於 handleSelectAnswer 當下記錄，這裡不再 submitAnswer，
  // 以免最後一題「submit 後立刻 finish」讀到舊 state；選取狀態的清空／還原交給上面的 layout effect）
  const handleNext = useCallback(() => {
    if (isLastQuestion) {
      onFinish();
    } else {
      nextQuestion();
    }
  }, [isLastQuestion, onFinish, nextQuestion]);

  // 上一題（選取狀態由 layout effect 依該題紀錄還原）
  const handlePrev = useCallback(() => {
    prevQuestion();
  }, [prevQuestion]);

  if (!currentQuestion) {
    return <div className="loading">載入中...</div>;
  }

  const showAnswer = config?.showAnswerImmediately && hasAnswered;

  return (
    <div className="quiz-page">
      {/* 進度條 + 結束測驗按鈕 */}
      <div className="quiz-progress">
        <div className="progress-info">
          <span>
            {progress.current} / {progress.total}
          </span>
          <span className="progress-info__right">
            <span>{progress.percentage}%</span>
            <button
              type="button"
              className="quiz-abort-btn"
              onClick={() => setAbortConfirmOpen(true)}
            >
              <span className="material-icons sm" aria-hidden="true">
                close
              </span>
              結束並返回首頁
            </button>
          </span>
        </div>
        <div className="progress-bar">
          <div
            className="progress-bar-fill"
            style={{ width: `${progress.percentage}%` }}
            role="progressbar"
            aria-valuenow={progress.percentage}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      </div>

      {/* 結束確認 dialog */}
      {abortConfirmOpen && (
        <div
          className="quiz-abort-dialog-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quiz-abort-dialog-title"
          onClick={() => setAbortConfirmOpen(false)}
        >
          <div className="quiz-abort-dialog" onClick={(e) => e.stopPropagation()}>
            <h2 id="quiz-abort-dialog-title">結束當前測驗？</h2>
            <p>
              您已答 {progress.answered} / {progress.total} 題。
              <br />
              進度會自動保留，下次回到首頁可繼續。
            </p>
            <div className="quiz-abort-dialog__actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setAbortConfirmOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={onAbort}
                autoFocus
              >
                結束並返回
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 題目卡片 */}
      <QuestionCard
        key={currentQuestion.id}
        question={currentQuestion}
        questionNumber={currentIndex + 1}
        selectedAnswer={selectedAnswer}
        showAnswer={showAnswer}
        onSelectAnswer={handleSelectAnswer}
      />

      {/* 導覽按鈕 */}
      <div className="quiz-navigation">
        <button
          className="btn btn-secondary"
          onClick={handlePrev}
          disabled={isFirstQuestion}
        >
          <span className="material-icons">chevron_left</span>
          上一題
        </button>

        <div className="nav-center">
          {config?.mode === 'practice' && !hasAnswered && selectedAnswer && (
            <span className="hint-text">點擊選項確認答案</span>
          )}
        </div>

        <button
          className="btn btn-primary"
          onClick={handleNext}
          disabled={!selectedAnswer && config?.mode === 'exam'}
        >
          {isLastQuestion ? (
            <>
              完成測驗
              <span className="material-icons">done_all</span>
            </>
          ) : (
            <>
              下一題
              <span className="material-icons">chevron_right</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default QuizPage;
