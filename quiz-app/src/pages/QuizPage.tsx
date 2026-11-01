// 測驗頁面元件
import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { QuestionCard } from '../components/QuestionCard';
import type { useQuiz } from '../hooks/useQuiz';
import './QuizPage.css';

function answerOutcome(answer: string | null, selected: string | null): string {
  if (answer === null) return '此題目無標準答案';
  return selected === answer ? '答對了' : `答錯了，正確答案是 ${answer}`;
}

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
  // 這一題剛剛怎麼作答的；回到答過的題目是 null，對錯不再念一次
  const [answeredBy, setAnsweredBy] = useState<'keyboard' | 'pointer' | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const navigationRef = useRef<HTMLDivElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const focusStemAfterNext = useRef(false);

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
    setAnsweredBy(null);
    if (focusStemAfterNext.current) {
      focusStemAfterNext.current = false;
      const stem = pageRef.current?.querySelector<HTMLElement>('.question-stem');
      stem?.focus({ preventScroll: true });
      stem?.scrollIntoView({ block: 'start' });
    }
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
        setAnsweredBy('pointer');
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

  const handleKeyboardAnswered = useCallback(() => setAnsweredBy('keyboard'), []);

  // 鍵盤作答後焦點落在下一題：選項鎖定後焦點會掉到 body，下一步要做的就是這顆。
  // 要等解析畫出來：導覽列這時才在最後的位置。捲導覽列，對錯文字與按鈕一起進視窗；自己捲而不靠 focus()，
  // 各引擎捲動量不同，Firefox 會把按鈕捲到中間。nearest 捲得最少，放得下時選項還在。
  useLayoutEffect(() => {
    if (answeredBy !== 'keyboard') return;
    nextButtonRef.current?.focus({ preventScroll: true });
    navigationRef.current?.scrollIntoView({ block: 'nearest' });
  }, [answeredBy]);

  // 上一題（選取狀態由 layout effect 依該題紀錄還原）
  const handlePrev = useCallback(() => {
    prevQuestion();
  }, [prevQuestion]);

  if (!currentQuestion) {
    return <div className="loading">載入中...</div>;
  }

  const showAnswer = config?.showAnswerImmediately && hasAnswered;

  return (
    <div className="quiz-page" ref={pageRef}>
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
        onKeyboardAnswered={config?.showAnswerImmediately ? handleKeyboardAnswered : undefined}
      />

      {/* 導覽按鈕 */}
      <div className="quiz-navigation" ref={navigationRef}>
        <button
          className="btn btn-secondary"
          onClick={handlePrev}
          disabled={isFirstQuestion}
        >
          <span className="material-icons">chevron_left</span>
          上一題
        </button>

        {/* 常駐的 live region，內容變動才會念。鍵盤作答時畫面捲到這裡，選項可能已經捲走，所以要看得見；
            滑鼠與觸控看著選項作答，只念給螢幕閱讀器 */}
        <div className="nav-center">
          {config?.showAnswerImmediately && (
            <p role="status" className={answeredBy === 'keyboard' ? 'answer-outcome' : 'sr-only'}>
              {answeredBy && answerOutcome(currentQuestion.answer, selectedAnswer)}
            </p>
          )}
        </div>

        <button
          ref={nextButtonRef}
          className="btn btn-primary"
          onClick={(e) => {
            // detail 0 是鍵盤或輔助工具的點擊：新題幹可能在畫面外，焦點跟著過去。不移到選項，連按 Enter 才不會替下一題作答
            focusStemAfterNext.current = !!config?.showAnswerImmediately && e.detail === 0;
            handleNext();
          }}
          onKeyDown={(e) => {
            // 按住 Enter 或空白鍵作答時，焦點已經移到這裡：重複的按鍵不算按下一題，否則一路跳題
            if (e.repeat && config?.showAnswerImmediately) e.preventDefault();
          }}
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
