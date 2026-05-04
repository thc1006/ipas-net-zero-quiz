// 測驗頁面元件
import { useState, useCallback, useEffect } from 'react';
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
    progress,
    config,
    isLastQuestion,
    isFirstQuestion,
    submitAnswer,
    nextQuestion,
    prevQuestion,
  } = quiz;

  // 選擇答案
  const handleSelectAnswer = useCallback(
    (answer: string) => {
      if (hasAnswered && config?.showAnswerImmediately) return;

      setSelectedAnswer(answer);

      if (config?.showAnswerImmediately) {
        submitAnswer(answer);
        setHasAnswered(true);
      }
    },
    [hasAnswered, config?.showAnswerImmediately, submitAnswer]
  );

  // 下一題
  const handleNext = useCallback(() => {
    if (!config?.showAnswerImmediately && !hasAnswered) {
      // 考試模式：提交當前答案
      submitAnswer(selectedAnswer);
    }

    if (isLastQuestion) {
      onFinish();
    } else {
      nextQuestion();
      setSelectedAnswer(null);
      setHasAnswered(false);
    }
  }, [
    config?.showAnswerImmediately,
    hasAnswered,
    isLastQuestion,
    submitAnswer,
    selectedAnswer,
    onFinish,
    nextQuestion,
  ]);

  // 上一題
  const handlePrev = useCallback(() => {
    prevQuestion();
    setSelectedAnswer(null);
    setHasAnswered(false);
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
              aria-label="結束測驗並返回首頁"
            >
              <span className="material-icons sm">close</span>
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
