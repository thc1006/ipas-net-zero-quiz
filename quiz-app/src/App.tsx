// 主應用程式元件
import { useState, useCallback, useEffect, useRef } from 'react';
import { ReviewPoolUnavailableError, useQuiz } from './hooks/useQuiz';
import { useAccessibility } from './hooks/useAccessibility';
import { usePracticeMode } from './hooks/usePracticeMode';
import { HomePage } from './pages/HomePage';
import { QuizPage } from './pages/QuizPage';
import { ResultPage } from './pages/ResultPage';
import { SettingsPage } from './pages/SettingsPage';
import { Header } from './components/Header';
import { VisitorCounter } from './components/VisitorCounter';
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary';
import { logger } from './utils/logger';
import { REPO_URL } from './data/app-meta';
import { DISCUSSIONS_URL, REPORT_URL } from './utils/feedback-url';
import { ReviewNotice } from './components/ReviewNotice/ReviewNotice';
import { isReviewSource, questionSourceNoun } from './utils/question-source';
import { clearReviewNotices, seedReview } from './utils/review-storage';
import { PAGE_LOAD_FAILED } from './utils/practice-pool';
import type { QuizConfig, QuizResult } from './types/quiz';
import './App.css';

type View = 'home' | 'quiz' | 'result' | 'settings';

function App() {
  const [currentView, setCurrentView] = useState<View>('home');
  const [lastResult, setLastResult] = useState<QuizResult | null>(null);
  const [startFailed, setStartFailed] = useState(false);
  const startFailedRef = useRef<HTMLDivElement>(null);
  const lastStartConfig = useRef<QuizConfig | null>(null);

  const quiz = useQuiz();
  const accessibility = useAccessibility();
  const practiceMode = usePracticeMode();
  // 再測一次沒有題目時的說明（星號與待複習錯題的名單可能已經空了）
  const [retryNotice, setRetryNotice] = useState<string | null>(null);

  // 提示是給當下這個畫面的：換頁就收掉，不跟到別的畫面（開始失敗的訊息由下面換頁時的 effect 收掉）
  const clearNotices = useCallback(() => {
    setRetryNotice(null);
    clearReviewNotices();
  }, []);

  // 舊的作答統計帶入待複習錯題：一個瀏覽器只做一次，開站時就做，題目來源選單才數得到
  useEffect(() => {
    seedReview();
  }, []);

  // 星號與待複習錯題走自己的路徑（名單上有練習池題時才載入練習池，不看加強練習開了沒）。其他來源：
  // 若使用者已啟用「加強練習池」（settings toggle），自動把練習池題目混入抽題範圍
  // （async startQuizWithPool；只出官方題目時不載入、不混入）；否則沿用同步 startQuiz。
  const launchQuiz = useCallback(
    async (config: QuizConfig): Promise<boolean> => {
      clearReviewNotices();
      if (isReviewSource(config.questionSource)) return quiz.startReviewQuiz(config);
      return practiceMode.enabled
        ? quiz.startQuizWithPool({ ...config, includePracticePool: true })
        : quiz.startQuiz(config);
    },
    [quiz, practiceMode.enabled]
  );

  // 開始測驗的結果只屬於按下開始的那個畫面：換頁、續作、停用練習池之後就不相干了，還在載入的也一起取消
  const { cancelPendingStart } = quiz;
  const startScope = useRef(0);
  useEffect(() => {
    setStartFailed(false);
    cancelPendingStart();
    startScope.current++;
  }, [currentView, practiceMode.enabled, cancelPendingStart]);

  // 開始按鈕在頁面下方，訊息在頁首：捲上來才看得到。WebKit 的 autoFocus 不會捲
  useEffect(() => {
    if (startFailed) startFailedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [startFailed]);

  // 開始測驗。一題都抽不到（只出官方題目而範圍內沒有官方題，#128）時不切頁，否則會停在只剩 header 的空白測驗頁。
  // 練習池是另一個 chunk：斷線時載不到，部署新版後舊分頁也載不到舊檔名，要告訴使用者。
  // 星號題與待複習錯題載不到練習池時（pool-unavailable）不顯示「再試一次」：這個頁面不會再載入（utils/review-pool.ts），
  // 首頁的選單與說明會跟著改，結果頁由再測一次說明。
  const startOrFail = useCallback(
    async (config: QuizConfig): Promise<'started' | 'empty' | 'pool-unavailable' | 'failed'> => {
      lastStartConfig.current = config;
      setStartFailed(false);
      try {
        const started = await launchQuiz(config);
        if (started) setCurrentView('quiz');
        return started ? 'started' : 'empty';
      } catch (err) {
        if (err instanceof ReviewPoolUnavailableError) return 'pool-unavailable';
        logger.error('開始測驗失敗：練習池載入不到', err);
        setStartFailed(true);
        return 'failed';
      }
    },
    [launchQuiz]
  );

  const handleStartQuiz = useCallback(
    async (config: QuizConfig) => {
      await startOrFail(config);
    },
    [startOrFail]
  );

  // 完成測驗
  const handleFinishQuiz = useCallback(() => {
    clearNotices(); // 在 finishQuiz 之前：它寫入失敗時的提示要留在結果頁
    const result = quiz.finishQuiz();
    if (result) {
      setLastResult(result);
      setCurrentView('result');
    }
  }, [quiz, clearNotices]);

  // 返回首頁（從 Header 或 ResultPage 觸發）— **不主動清 quiz state**
  // 設計依據（Refs #71）：
  // - 從 Result 來：finishQuiz 已 reset + clearProgress，多餘 reset 為 idempotent no-op
  // - 從 Header 在 quiz 中按：使用者期待「離開但保留進度」與 abort button 一致；
  //   若此時呼叫 resetQuiz 會清掉 localStorage 進度，違反 PR 對使用者的承諾
  // → 統一不主動 reset；徹底重來由「開始新測驗」自然覆寫，或 finishQuiz 完成清除
  const handleGoHome = useCallback(() => {
    setLastResult(null);
    clearNotices();
    setCurrentView('home');
  }, [clearNotices]);

  // 結束測驗但保留進度（Refs #71）— softReset in-memory state，localStorage 不動
  // 避免 abort 後 quiz hook 仍殘留 isActive=true 狀態（M1 修補）
  const handleAbortQuiz = useCallback(() => {
    clearNotices();
    quiz.softReset();
    setLastResult(null);
    setCurrentView('home');
  }, [quiz, clearNotices]);

  // 從首頁 resume hint 點「繼續測驗」（Refs #71）
  const handleResumeQuiz = useCallback(() => {
    clearNotices();
    if (quiz.resumeQuiz()) {
      setCurrentView('quiz');
    }
  }, [quiz, clearNotices]);

  // 重新測驗（抽不到題目時同樣不切頁）。星號與待複習錯題依現在的名單重新抽題，名單空了就留在結果頁並說明
  const handleRetry = useCallback(async () => {
    if (!lastResult?.config) return;
    const source = lastResult.config.questionSource;
    const scope = startScope.current;
    const outcome = await startOrFail(lastResult.config);
    // 等練習池的時候換了頁或切了加強練習池：這一次是取消了，不是名單空了
    if (scope !== startScope.current || !isReviewSource(source)) return;
    if (outcome === 'empty') {
      setRetryNotice(`目前沒有${questionSourceNoun(source)}可以再測一次，回首頁可以選其他題目來源。`);
    } else if (outcome === 'pool-unavailable') {
      // 名單上還有題目，只是練習池載不到：不能說名單空了
      setRetryNotice(PAGE_LOAD_FAILED);
    }
  }, [startOrFail, lastResult]);

  // 開啟設定
  const handleOpenSettings = useCallback(() => {
    clearNotices();
    setCurrentView('settings');
  }, [clearNotices]);

  // 關閉設定
  const handleCloseSettings = useCallback(() => {
    clearNotices();
    setCurrentView('home');
  }, [clearNotices]);

  return (
    <div className="app">
      {/* 跳過連結（無障礙） */}
      <a href="#main-content" className="skip-link">
        跳到主要內容
      </a>

      <Header
        onOpenSettings={handleOpenSettings}
        onGoHome={handleGoHome}
        accessibility={accessibility}
      />

      <main id="main-content" className="main-content">
        {/* 排在文件流裡，蓋不到頁面內容。焦點放在再試一次：結果頁重新載入會失去這份結果，不能一按 Enter 就發生 */}
        {startFailed && (
          <div className="start-failed" role="alert" ref={startFailedRef}>
            <p>
              題目載入失敗，網站可能剛更新。請再試一次，或重新載入頁面。
              {currentView === 'result' && '重新載入會清掉這份結果。'}
            </p>
            <button
              className="btn btn-primary"
              onClick={() => lastStartConfig.current && handleStartQuiz(lastStartConfig.current)}
              autoFocus
            >
              再試一次
            </button>
            <button className="btn btn-secondary" onClick={() => window.location.reload()}>
              重新載入
            </button>
            <button className="btn btn-secondary" onClick={() => setStartFailed(false)}>
              關閉
            </button>
          </div>
        )}
        <ReviewNotice view={currentView} />
        <ErrorBoundary>
          {currentView === 'home' && (
            <HomePage
              onStartQuiz={handleStartQuiz}
              onResumeQuiz={handleResumeQuiz}
            />
          )}

          {currentView === 'quiz' && quiz.currentQuestion && (
            <QuizPage
              quiz={quiz}
              onFinish={handleFinishQuiz}
              onAbort={handleAbortQuiz}
            />
          )}

          {currentView === 'result' && lastResult && (
            <ResultPage
              result={lastResult}
              onGoHome={handleGoHome}
              onRetry={handleRetry}
              retryNotice={retryNotice}
            />
          )}

          {currentView === 'settings' && (
            <SettingsPage
              accessibility={accessibility}
              onClose={handleCloseSettings}
            />
          )}
        </ErrorBoundary>
      </main>

      {/* 頁尾 */}
      <footer className="app-footer">
        <div className="container">
          <div className="footer-links">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub 專案連結"
            >
              <span className="material-icons sm">code</span>
              GitHub
            </a>
            <span className="divider">·</span>
            <a href={REPORT_URL} target="_blank" rel="noopener noreferrer">
              回報問題
            </a>
            <span className="divider">·</span>
            <a href={DISCUSSIONS_URL} target="_blank" rel="noopener noreferrer">
              討論區
            </a>
            <span className="divider">·</span>
            <VisitorCounter />
          </div>
          <p className="copyright">
            題庫僅供練習參考
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
