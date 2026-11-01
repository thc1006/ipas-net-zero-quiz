// 主應用程式元件
import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuiz } from './hooks/useQuiz';
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

  // 開始測驗的結果只屬於按下開始的那個畫面：換頁、續作、停用練習池之後就不相干了，還在載入的也一起取消
  const { cancelPendingStart } = quiz;
  useEffect(() => {
    setStartFailed(false);
    cancelPendingStart();
  }, [currentView, practiceMode.enabled, cancelPendingStart]);

  // 開始按鈕在頁面下方，訊息在頁首：捲上來才看得到。WebKit 的 autoFocus 不會捲
  useEffect(() => {
    if (startFailed) startFailedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [startFailed]);

  // 開始測驗 — 若使用者已啟用「加強練習池」（settings toggle），自動把練習池
  // 題目混入抽題範圍（async startQuizWithPool；只出官方題目時不載入、不混入）；否則沿用同步 startQuiz。
  // 一題都抽不到（只出官方題目而範圍內沒有官方題，#128）時不切頁，否則會停在只剩 header 的空白測驗頁。
  // 練習池是另一個 chunk：斷線時載不到，部署新版後舊分頁也載不到舊檔名，要告訴使用者。
  const handleStartQuiz = useCallback(
    async (config: QuizConfig) => {
      lastStartConfig.current = config;
      setStartFailed(false);
      try {
        const started = practiceMode.enabled
          ? await quiz.startQuizWithPool({ ...config, includePracticePool: true })
          : quiz.startQuiz(config);
        if (started) setCurrentView('quiz');
      } catch (err) {
        logger.error('開始測驗失敗：練習池載入不到', err);
        setStartFailed(true);
      }
    },
    [quiz, practiceMode.enabled]
  );

  // 完成測驗
  const handleFinishQuiz = useCallback(() => {
    const result = quiz.finishQuiz();
    if (result) {
      setLastResult(result);
      setCurrentView('result');
    }
  }, [quiz]);

  // 返回首頁（從 Header 或 ResultPage 觸發）— **不主動清 quiz state**
  // 設計依據（Refs #71）：
  // - 從 Result 來：finishQuiz 已 reset + clearProgress，多餘 reset 為 idempotent no-op
  // - 從 Header 在 quiz 中按：使用者期待「離開但保留進度」與 abort button 一致；
  //   若此時呼叫 resetQuiz 會清掉 localStorage 進度，違反 PR 對使用者的承諾
  // → 統一不主動 reset；徹底重來由「開始新測驗」自然覆寫，或 finishQuiz 完成清除
  const handleGoHome = useCallback(() => {
    setLastResult(null);
    setCurrentView('home');
  }, []);

  // 結束測驗但保留進度（Refs #71）— softReset in-memory state，localStorage 不動
  // 避免 abort 後 quiz hook 仍殘留 isActive=true 狀態（M1 修補）
  const handleAbortQuiz = useCallback(() => {
    quiz.softReset();
    setLastResult(null);
    setCurrentView('home');
  }, [quiz]);

  // 從首頁 resume hint 點「繼續測驗」（Refs #71）
  const handleResumeQuiz = useCallback(() => {
    if (quiz.resumeQuiz()) {
      setCurrentView('quiz');
    }
  }, [quiz]);

  // 重新測驗（抽不到題目時同樣不切頁）
  const handleRetry = useCallback(async () => {
    if (lastResult?.config) await handleStartQuiz(lastResult.config);
  }, [lastResult, handleStartQuiz]);

  // 開啟設定
  const handleOpenSettings = useCallback(() => {
    setCurrentView('settings');
  }, []);

  // 關閉設定
  const handleCloseSettings = useCallback(() => {
    setCurrentView('home');
  }, []);

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
              href="https://github.com/thc1006/ipas-net-zero-quiz"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub 專案連結"
            >
              <span className="material-icons sm">code</span>
              GitHub
            </a>
            <span className="divider">·</span>
            <a
              href="https://github.com/thc1006/ipas-net-zero-quiz/discussions/1"
              target="_blank"
              rel="noopener noreferrer"
            >
              問題回報
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
