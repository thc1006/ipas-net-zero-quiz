// 首頁元件 - 測驗配置與開始
import { useState, useCallback, useEffect } from 'react';
import { stats } from '../data/questions';
import { PRACTICE_POOL_COUNTS } from '../data/practice-pool-counts';
import { defaultConfig } from '../hooks/useQuiz';
import { usePracticeMode } from '../hooks/usePracticeMode';
import { PracticeOptInDialog } from '../components/PracticeOptInDialog/PracticeOptInDialog';
import { PracticePoolHistogram } from '../components/PracticePoolHistogram/PracticePoolHistogram';
import { readBool, writeBool } from '../utils/local-storage';
import type { QuizConfig, ExamSubject } from '../types/quiz';
import './HomePage.css';

function mainBankCountForSubject(subject: ExamSubject | 'all'): number {
  if (subject === '考科1') return stats.subject1;
  if (subject === '考科2') return stats.subject2;
  return stats.total;
}

// localStorage key：使用者是否曾看過揭露 dialog（accept/decline 都算看過）
// 用來避免每次進首頁都自動彈 — 一次就夠
const DISCLOSURE_SEEN_KEY = 'practice-pool-disclosure-seen';

/** 題數上限 */
const QUESTION_COUNT_MAX = 100;

/**
 * 可開始測驗時回傳 1–100（超過 100 夾為 100）；空白、非純整數、< 1 皆為 null。
 * 嚴格只接受純十進位整數字串，避免 "12abc"、"1.5"、"-5" 等被 parseInt 誤判。
 */
function parseClampedQuestionCount(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number.parseInt(s, 10);
  if (n < 1) return null;
  return Math.min(QUESTION_COUNT_MAX, n);
}

interface HomePageProps {
  onStartQuiz: (config: QuizConfig) => void;
}

// `questionCount` 在此頁的 source-of-truth 是 questionCountInput（字串），
// 故從 config state 移除以避免兩個來源並存。送出時才補上 parsed 數值。
type HomePageConfig = Omit<QuizConfig, 'questionCount'>;
const { questionCount: _defaultQuestionCount, ...defaultHomeConfig } = defaultConfig;

export function HomePage({ onStartQuiz }: HomePageProps) {
  const [config, setConfig] = useState<HomePageConfig>(defaultHomeConfig);
  const [questionCountInput, setQuestionCountInput] = useState(() =>
    String(defaultConfig.questionCount)
  );
  const practiceMode = usePracticeMode();
  const [optInDialogOpen, setOptInDialogOpen] = useState(false);
  const parsedQuestionCount = parseClampedQuestionCount(questionCountInput);
  const canStartQuiz = parsedQuestionCount !== null;

  // 首次進首頁、尚未 opt-in、尚未看過揭露 → 自動彈 dialog
  // 已 opt-in 過或已 dismissed 過則不彈
  useEffect(() => {
    if (practiceMode.hasOptedIn) return;
    if (readBool(DISCLOSURE_SEEN_KEY)) return;
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
    writeBool(DISCLOSURE_SEEN_KEY, true);
    practiceMode.acceptOptIn();
    setOptInDialogOpen(false);
  }, [practiceMode]);

  const handleDeclineOptIn = useCallback(() => {
    writeBool(DISCLOSURE_SEEN_KEY, true);
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
      setQuestionCountInput(e.target.value);
    },
    []
  );

  // 失焦時把合法輸入正規化（去前後空白、去前導零、超過 100 夾為 100），
  // 避免「打 500、實際只跑 100」或「  20  」殘留空白的視覺落差
  const handleCountBlur = useCallback(() => {
    setQuestionCountInput((prev) => {
      const n = parseClampedQuestionCount(prev);
      return n !== null && String(n) !== prev ? String(n) : prev;
    });
  }, []);

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
    if (parsedQuestionCount === null) return;
    onStartQuiz({ ...config, questionCount: parsedQuestionCount });
  }, [config, onStartQuiz, parsedQuestionCount]);

  const countHintId = 'count-hint';

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
              title={`加強練習池：含 ${PRACTICE_POOL_COUNTS.externalMock} 題公開模擬題 + ${PRACTICE_POOL_COUNTS.aiGenerated} 題 AI 產題（每題附來源徽章）`}
            >
              <span className="material-icons sm">auto_awesome</span>
              +{PRACTICE_POOL_COUNTS.total} 題加強練習
            </button>
          )}
        </div>
      </section>

      {/* 加強練習池 tip card — 隨啟用狀態切換內容，避免突然消失造成困惑 */}
      {(() => {
        const { enabled, hasOptedIn } = practiceMode;
        let title: string;
        let desc: string;
        let ctaLabel: string;
        let ctaIcon: string;
        let modifierClass: string;

        if (enabled) {
          title = '加強練習池已啟用';
          desc = `下一場測驗會額外混入 ${PRACTICE_POOL_COUNTS.total} 題（${PRACTICE_POOL_COUNTS.externalMock} 模擬 + ${PRACTICE_POOL_COUNTS.aiGenerated} AI 產題；每題附來源徽章）。`;
          ctaLabel = '停用加強練習';
          ctaIcon = 'remove_circle_outline';
          modifierClass = 'practice-pool-tip--enabled';
        } else if (hasOptedIn) {
          title = '想多練？啟用加強練習池';
          desc = `加強練習池含 ${PRACTICE_POOL_COUNTS.externalMock} 題公開模擬題 + ${PRACTICE_POOL_COUNTS.aiGenerated} 題 AI 產題（每題附來源徽章），啟用後下一場練習會混入這 ${PRACTICE_POOL_COUNTS.total} 題。`;
          ctaLabel = `啟用 +${PRACTICE_POOL_COUNTS.total} 題加強練習`;
          ctaIcon = 'add_circle_outline';
          modifierClass = '';
        } else {
          title = '想多練？啟用加強練習池';
          desc = `加強練習池含 ${PRACTICE_POOL_COUNTS.externalMock} 題公開模擬題 + ${PRACTICE_POOL_COUNTS.aiGenerated} 題 AI 產題；AI 產題依 EU AI Act Art.50 揭露，每題經獨立驗證且附 primary-source URL。`;
          ctaLabel = `了解並啟用 +${PRACTICE_POOL_COUNTS.total} 題加強練習`;
          ctaIcon = 'add_circle_outline';
          modifierClass = '';
        }

        return (
          <section
            className={`practice-pool-tip card ${modifierClass}`}
            data-testid="practice-pool-tip"
            aria-labelledby="practice-pool-tip-heading"
          >
            <div className="practice-pool-tip__icon">
              <span className="material-icons">
                {enabled ? 'check_circle' : 'auto_awesome'}
              </span>
            </div>
            <div className="practice-pool-tip__body">
              <h3 id="practice-pool-tip-heading" className="practice-pool-tip__title">
                {title}
              </h3>
              <p className="practice-pool-tip__desc">{desc}</p>
              {enabled && (
                <details className="practice-pool-tip__details">
                  <summary className="practice-pool-tip__details-summary">
                    查看抽題分布
                  </summary>
                  <div className="practice-pool-tip__details-content">
                    <PracticePoolHistogram
                      mainBankCount={mainBankCountForSubject(config.subject)}
                      subject={config.subject}
                    />
                  </div>
                </details>
              )}
              <button
                type="button"
                className={`btn ${enabled ? 'btn-secondary' : 'btn-primary'} practice-pool-tip__cta`}
                onClick={handlePracticeToggle}
              >
                <span className="material-icons sm">{ctaIcon}</span>
                {ctaLabel}
              </button>
            </div>
          </section>
        );
      })()}

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
              max={QUESTION_COUNT_MAX}
              value={questionCountInput}
              onChange={handleCountChange}
              onBlur={handleCountBlur}
              aria-label="題數"
              aria-invalid={!canStartQuiz}
              aria-describedby={countHintId}
            />
            <p
              id={countHintId}
              className={`config-item__hint${canStartQuiz ? '' : ' config-item__hint--error'}`}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {canStartQuiz
                ? `請輸入 1–${QUESTION_COUNT_MAX} 之間的整數`
                : `請輸入 1–${QUESTION_COUNT_MAX} 之間的題數才能開始測驗`}
            </p>
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
        <button
          type="button"
          className="btn btn-primary start-btn"
          onClick={handleStart}
          disabled={!canStartQuiz}
        >
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
