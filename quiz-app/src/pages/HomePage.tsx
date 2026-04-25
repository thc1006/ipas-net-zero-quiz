// 首頁元件 - 測驗配置與開始
import { useState, useCallback, useEffect } from 'react';
import { stats } from '../data/questions';
import { defaultConfig } from '../hooks/useQuiz';
import { usePracticeMode } from '../hooks/usePracticeMode';
import { PracticeOptInDialog } from '../components/PracticeOptInDialog/PracticeOptInDialog';
import type { QuizConfig, ExamSubject } from '../types/quiz';
import './HomePage.css';

// 加強練習池總題數 — 與 src/data/practice_pool.json _meta.totals.total 同步
// (55 external_mock + 96 ai_generated)
const PRACTICE_POOL_TOTAL = 151;
const PRACTICE_POOL_MOCK = 55;
const PRACTICE_POOL_AI = 96;

// localStorage key：使用者是否曾看過揭露 dialog（accept/decline 都算看過）
// 用來避免每次進首頁都自動彈 — 一次就夠
const DISCLOSURE_SEEN_KEY = 'practice-pool-disclosure-seen';

function readDisclosureSeen(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(DISCLOSURE_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markDisclosureSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DISCLOSURE_SEEN_KEY, '1');
  } catch {
    /* quota or disabled — silently ignore */
  }
}

interface HomePageProps {
  onStartQuiz: (config: QuizConfig) => void;
}

export function HomePage({ onStartQuiz }: HomePageProps) {
  const [config, setConfig] = useState<QuizConfig>(defaultConfig);
  const practiceMode = usePracticeMode();
  const [optInDialogOpen, setOptInDialogOpen] = useState(false);

  // 首次進首頁、尚未 opt-in、尚未看過揭露 → 自動彈 dialog
  // 已 opt-in 過或已 dismissed 過則不彈
  useEffect(() => {
    if (practiceMode.hasOptedIn) return;
    if (readDisclosureSeen()) return;
    setOptInDialogOpen(true);
  }, [practiceMode.hasOptedIn]);

  const handlePracticeToggle = useCallback(() => {
    if (practiceMode.enabled) {
      practiceMode.disable();
      return;
    }
    if (practiceMode.hasOptedIn) {
      // 已揭露過，直接啟用不再彈 dialog
      practiceMode.enable();
      return;
    }
    setOptInDialogOpen(true);
  }, [practiceMode]);

  const handleAcceptOptIn = useCallback(() => {
    markDisclosureSeen();
    practiceMode.acceptOptIn();
    setOptInDialogOpen(false);
  }, [practiceMode]);

  const handleDeclineOptIn = useCallback(() => {
    markDisclosureSeen();
    setOptInDialogOpen(false);
  }, []);

  const handleSubjectChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value as ExamSubject | 'all';
      setConfig((prev) => ({ ...prev, subject: value }));
    },
    []
  );

  const handleCountChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = Math.max(1, Math.min(100, parseInt(e.target.value) || 20));
      setConfig((prev) => ({ ...prev, questionCount: value }));
    },
    []
  );

  const handleModeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const mode = e.target.value as QuizConfig['mode'];
      setConfig((prev) => ({
        ...prev,
        mode,
        showAnswerImmediately: mode === 'practice',
      }));
    },
    []
  );

  const handleShuffleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setConfig((prev) => ({ ...prev, shuffleQuestions: e.target.checked }));
    },
    []
  );

  const handleStart = useCallback(() => {
    onStartQuiz(config);
  }, [config, onStartQuiz]);

  return (
    <div className="home-page animate-fade-in">
      {/* 標題區 */}
      <section className="hero-section">
        <h1>
          <span className="material-icons lg hero-icon">eco</span>
          淨零碳備考神器
        </h1>
        <p className="hero-subtitle">
          iPAS 淨零碳規劃管理師 考古題線上測驗
        </p>
        <div className="stats-badges">
          <span className="badge badge-success">
            <span className="material-icons sm">quiz</span>
            {stats.total} 題
          </span>
          <span className="badge badge-info">
            考科一 {stats.subject1} 題
          </span>
          <span className="badge badge-info">
            考科二 {stats.subject2} 題
          </span>
          {practiceMode.enabled ? (
            <button
              type="button"
              className="badge badge-warning badge-button"
              onClick={handlePracticeToggle}
              aria-label="停用加強練習池"
              title="加強練習池啟用中：包含模擬題與 AI 產題（點擊可停用）"
            >
              <span className="material-icons sm">auto_awesome</span>
              加強練習池啟用中
            </button>
          ) : (
            <button
              type="button"
              className="badge badge-info badge-button"
              onClick={handlePracticeToggle}
              aria-label="啟用加強練習池"
              title="加強練習池：含 55 題公開模擬題 + 96 題 AI 產題（每題附來源徽章）"
            >
              <span className="material-icons sm">auto_awesome</span>
              +{PRACTICE_POOL_TOTAL} 題加強練習
            </button>
          )}
        </div>
      </section>

      {/* 加強練習池介紹 tip card —— 未啟用時顯示，提供 discoverable 入口 */}
      {!practiceMode.enabled && (
        <section
          className="practice-pool-tip card"
          data-testid="practice-pool-tip"
          aria-labelledby="practice-pool-tip-heading"
        >
          <div className="practice-pool-tip__icon">
            <span className="material-icons">auto_awesome</span>
          </div>
          <div className="practice-pool-tip__body">
            <h3 id="practice-pool-tip-heading" className="practice-pool-tip__title">
              想多練？啟用加強練習池
            </h3>
            <p className="practice-pool-tip__desc">
              {practiceMode.hasOptedIn
                ? `加強練習池含 ${PRACTICE_POOL_MOCK} 題公開模擬題 + ${PRACTICE_POOL_AI} 題 AI 產題（每題附來源徽章），啟用後下一場練習會混入這 ${PRACTICE_POOL_TOTAL} 題。`
                : `加強練習池含 ${PRACTICE_POOL_MOCK} 題公開模擬題 + ${PRACTICE_POOL_AI} 題 AI 產題；AI 產題依 EU AI Act Art.50 揭露，每題經獨立驗證且附 primary-source URL。`}
            </p>
            <button
              type="button"
              className="btn btn-primary practice-pool-tip__cta"
              onClick={handlePracticeToggle}
            >
              <span className="material-icons sm">add_circle_outline</span>
              {practiceMode.hasOptedIn ? `啟用 +${PRACTICE_POOL_TOTAL} 題加強練習` : `了解並啟用 +${PRACTICE_POOL_TOTAL} 題加強練習`}
            </button>
          </div>
        </section>
      )}

      {/* AI 產題揭露對話框（首次自動彈，或從 badge / tip card CTA 觸發） */}
      <PracticeOptInDialog
        open={optInDialogOpen}
        onAccept={handleAcceptOptIn}
        onDecline={handleDeclineOptIn}
      />

      {/* 測驗配置 */}
      <section className="config-section card">
        <h2>測驗設定</h2>

        <div className="config-grid">
          {/* 考科選擇 */}
          <div className="config-item">
            <label htmlFor="subject">考科範圍</label>
            <select
              id="subject"
              value={config.subject}
              onChange={handleSubjectChange}
            >
              <option value="all">全部 ({stats.total} 題)</option>
              <option value="考科1">
                考科一：淨零碳規劃管理基礎概論 ({stats.subject1} 題)
              </option>
              <option value="考科2">
                考科二：淨零碳盤查範圍與程序概要 ({stats.subject2} 題)
              </option>
            </select>
          </div>

          {/* 測驗模式 */}
          <div className="config-item">
            <label htmlFor="mode">測驗模式</label>
            <select id="mode" value={config.mode} onChange={handleModeChange}>
              <option value="practice">練習模式（即時顯示答案）</option>
              <option value="exam">考試模式（最後顯示結果）</option>
            </select>
          </div>

          {/* 題數 */}
          <div className="config-item">
            <label htmlFor="count">題數</label>
            <input
              type="number"
              id="count"
              min={1}
              max={100}
              value={config.questionCount}
              onChange={handleCountChange}
              aria-label="題數"
            />
          </div>

          {/* 隨機排序 */}
          <div className="config-item checkbox-item">
            <label>
              <input
                type="checkbox"
                checked={config.shuffleQuestions}
                onChange={handleShuffleChange}
              />
              <span>隨機出題順序</span>
            </label>
          </div>
        </div>

        {/* 開始按鈕 */}
        <button className="btn btn-primary start-btn" onClick={handleStart}>
          <span className="material-icons">play_arrow</span>
          開始測驗
        </button>
      </section>

      {/* 考科說明 */}
      <section className="info-section">
        <div className="info-cards">
          <article className="info-card card">
            <h3>
              <span className="material-icons">menu_book</span>
              考科一
            </h3>
            <p className="info-title">淨零碳規劃管理基礎概論</p>
            <ul>
              <li>淨零排放國際發展與政策趨勢</li>
              <li>永續發展與碳中和目標</li>
              <li>溫室氣體基礎知識</li>
              <li>碳管理策略與工具</li>
            </ul>
          </article>

          <article className="info-card card">
            <h3>
              <span className="material-icons">analytics</span>
              考科二
            </h3>
            <p className="info-title">淨零碳盤查範圍與程序概要</p>
            <ul>
              <li>ISO 14064 溫室氣體盤查標準</li>
              <li>組織碳盤查範疇與邊界</li>
              <li>排放係數與計算方法</li>
              <li>碳盤查報告與查證</li>
            </ul>
          </article>
        </div>
      </section>
    </div>
  );
}

export default HomePage;
