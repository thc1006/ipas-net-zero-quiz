// 主應用程式元件
import { useState, useCallback } from 'react';
import { useQuiz } from './hooks/useQuiz';
import { useAccessibility } from './hooks/useAccessibility';
import { HomePage } from './pages/HomePage';
import { QuizPage } from './pages/QuizPage';
import { ResultPage } from './pages/ResultPage';
import { SettingsPage } from './pages/SettingsPage';
import { Header } from './components/Header';
import { VisitorCounter } from './components/VisitorCounter';
import type { QuizConfig, QuizResult } from './types/quiz';
import './App.css';

type View = 'home' | 'quiz' | 'result' | 'settings';

function App() {
  const [currentView, setCurrentView] = useState<View>('home');
  const [lastResult, setLastResult] = useState<QuizResult | null>(null);

  const quiz = useQuiz();
  const accessibility = useAccessibility();

  // 開始測驗
  const handleStartQuiz = useCallback(
    (config: QuizConfig) => {
      quiz.startQuiz(config);
      setCurrentView('quiz');
    },
    [quiz]
  );

  // 完成測驗
  const handleFinishQuiz = useCallback(() => {
    const result = quiz.finishQuiz();
    if (result) {
      setLastResult(result);
      setCurrentView('result');
    }
  }, [quiz]);

  // 返回首頁
  const handleGoHome = useCallback(() => {
    quiz.resetQuiz();
    setLastResult(null);
    setCurrentView('home');
  }, [quiz]);

  // 重新測驗
  const handleRetry = useCallback(() => {
    if (lastResult?.config) {
      quiz.startQuiz(lastResult.config);
      setCurrentView('quiz');
    }
  }, [quiz, lastResult]);

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
        {currentView === 'home' && (
          <HomePage onStartQuiz={handleStartQuiz} />
        )}

        {currentView === 'quiz' && quiz.currentQuestion && (
          <QuizPage
            quiz={quiz}
            onFinish={handleFinishQuiz}
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
