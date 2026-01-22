// 測驗頁面元件
import { useState, useCallback } from 'react';
import { QuestionCard } from '../components/QuestionCard';
import type { useQuiz } from '../hooks/useQuiz';
import './QuizPage.css';

interface QuizPageProps {
  quiz: ReturnType<typeof useQuiz>;
  onFinish: () => void;
}

export function QuizPage({ quiz, onFinish }: QuizPageProps) {
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [hasAnswered, setHasAnswered] = useState(false);

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
      {/* 進度條 */}
      <div className="quiz-progress">
        <div className="progress-info">
          <span>
            {progress.current} / {progress.total}
          </span>
          <span>{progress.percentage}%</span>
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
