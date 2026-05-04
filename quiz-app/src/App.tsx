// 主應用程式元件
import { useState, useCallback } from 'react';
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
import type { QuizConfig, QuizResult } from './types/quiz';
import './App.css';

type View = 'home' | 'quiz' | 'result' | 'settings';

function App() {
  const [currentView, setCurrentView] = useState<View>('home');
  const [lastResult, setLastResult] = useState<QuizResult | null>(null);

  const quiz = useQuiz();
  const accessibility = useAccessibility();
  const practiceMode = usePracticeMode();

  // 開始測驗 — 若使用者已啟用「加強練習池」（settings toggle），自動把練習池
  // 題目混入抽題範圍（async startQuizWithPool）；否則沿用同步 startQuiz。
  const handleStartQuiz = useCallback(
    async (config: QuizConfig) => {
      if (practiceMode.enabled) {
        await quiz.startQuizWithPool({ ...config, includePracticePool: true });
      } else {
        quiz.startQuiz(config);
      }
      setCurrentView('quiz');
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

  // 返回首頁（重置 quiz + 清持久化進度）
  const handleGoHome = useCallback(() => {
    quiz.resetQuiz();
    setLastResult(null);
    setCurrentView('home');
  }, [quiz]);

  // 結束測驗但保留進度（Refs #71）— 不清 localStorage、回首頁
  // 與 handleGoHome 的差異：abort 不呼叫 resetQuiz（resetQuiz 會 clearProgress）
  const handleAbortQuiz = useCallback(() => {
    setLastResult(null);
    setCurrentView('home');
  }, []);

  // 從首頁 resume hint 點「繼續測驗」（Refs #71）
  const handleResumeQuiz = useCallback(() => {
    if (quiz.resumeQuiz()) {
      setCurrentView('quiz');
    }
  }, [quiz]);

  // 重新測驗
  const handleRetry = useCallback(async () => {
    if (lastResult?.config) {
      if (practiceMode.enabled) {
        await quiz.startQuizWithPool({ ...lastResult.config, includePracticePool: true });
      } else {
        quiz.startQuiz(lastResult.config);
      }
      setCurrentView('quiz');
    }
  }, [quiz, lastResult, practiceMode.enabled]);

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
