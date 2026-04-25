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

  // 返回首頁
  const handleGoHome = useCallback(() => {
    quiz.resetQuiz();
    setLastResult(null);
    setCurrentView('home');
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

      {/* 頁尾 — Carbon Ledger 簽署列 */}
      <footer className="app-footer cl-footer">
        <div className="container cl-footer__container">
          <div className="cl-footer__col cl-footer__col--brand">
            <span className="cl-eyebrow cl-footer__mark">— END OF DOCUMENT</span>
            <p className="cl-footer__disclaimer">
              題庫僅供練習參考；非 iPAS 官方教材。每題答案皆附第一手 primary-source 引證。
            </p>
          </div>

          <div className="cl-footer__col cl-footer__col--links">
            <span className="cl-eyebrow">索引</span>
            <ul className="cl-footer__links">
              <li>
                <a
                  href="https://github.com/thc1006/ipas-net-zero-quiz"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="GitHub 專案連結"
                >
                  <span className="material-icons sm">code</span>
                  原始碼
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/thc1006/ipas-net-zero-quiz/discussions/1"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="material-icons sm">forum</span>
                  社群討論 / 問題回報
                </a>
              </li>
            </ul>
          </div>

          <div className="cl-footer__col cl-footer__col--meta">
            <span className="cl-eyebrow">登錄</span>
            <div className="cl-footer__counter">
              <VisitorCounter />
              <span className="cl-footer__counter-caption">累積訪客（per-session 去重）</span>
            </div>
          </div>
        </div>
        <hr className="cl-rule cl-rule--soft cl-footer__sig" aria-hidden="true" />
        <p className="copyright cl-footer__copy cl-figure" aria-label="copyright">
          NZ-Q · ARCHIVE EDITION 2026 / Q2 · v1.0.0
        </p>
      </footer>
    </div>
  );
}

export default App;
