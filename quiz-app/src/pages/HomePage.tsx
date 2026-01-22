// 首頁元件 - 測驗配置與開始
import { useState, useCallback } from 'react';
import { stats } from '../data/questions';
import { defaultConfig } from '../hooks/useQuiz';
import type { QuizConfig, ExamSubject } from '../types/quiz';
import './HomePage.css';

interface HomePageProps {
  onStartQuiz: (config: QuizConfig) => void;
}

export function HomePage({ onStartQuiz }: HomePageProps) {
  const [config, setConfig] = useState<QuizConfig>(defaultConfig);

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
        </div>
      </section>

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
