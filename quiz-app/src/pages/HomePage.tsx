// 首頁元件 — Carbon Ledger / Atmospheric Archive 設計
// 設計概念：頁面像一本「碳審計年鑑」的扉頁；配置區像填寫測驗工作單。
import { useState, useCallback } from 'react';
import { stats } from '../data/questions';
import { PRACTICE_POOL_COUNTS } from '../data/practice-pool-counts';
import { defaultConfig } from '../hooks/useQuiz';
import { usePracticeMode } from '../hooks/usePracticeMode';
import type { QuizConfig, ExamSubject } from '../types/quiz';
import './HomePage.css';

interface HomePageProps {
  onStartQuiz: (config: QuizConfig) => void;
}

const MODE_OPTIONS: ReadonlyArray<{
  value: QuizConfig['mode'];
  title: string;
  desc: string;
  icon: string;
}> = [
  {
    value: 'practice',
    title: '練習模式',
    desc: '每題作答後立即看到答案與 AI 解析；適合學新主題',
    icon: 'self_improvement',
  },
  {
    value: 'exam',
    title: '考試模式',
    desc: '所有題目作答完才公布；模擬正式考場節奏',
    icon: 'timer',
  },
];

const SUBJECT_OPTIONS: ReadonlyArray<{
  value: ExamSubject | 'all';
  number: string;
  title: string;
  count: number;
}> = [
  { value: 'all', number: '00', title: '兩科混合', count: stats.total },
  { value: '考科1', number: '01', title: '淨零碳規劃管理基礎概論', count: stats.subject1 },
  { value: '考科2', number: '02', title: '淨零碳盤查範圍與程序概要', count: stats.subject2 },
];

export function HomePage({ onStartQuiz }: HomePageProps) {
  const [config, setConfig] = useState<QuizConfig>(defaultConfig);
  const practiceMode = usePracticeMode();

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

  const pickMode = useCallback(
    (mode: QuizConfig['mode']) => {
      setConfig((prev) => ({
        ...prev,
        mode,
        showAnswerImmediately: mode === 'practice',
      }));
    },
    []
  );

  const pickSubject = useCallback((subject: ExamSubject | 'all') => {
    setConfig((prev) => ({ ...prev, subject }));
  }, []);

  const handleStart = useCallback(() => {
    onStartQuiz(config);
  }, [config, onStartQuiz]);

  return (
    <div className="home-page cl-page animate-fade-in">
      {/* HERO — 像扉頁 */}
      <section className="cl-hero">
        <div className="cl-hero__meta">
          <span className="cl-eyebrow">VOL.&nbsp;01 — 2026 / Q2 EDITION</span>
          <span className="cl-eyebrow cl-hero__archive-id cl-figure">
            ARCHIVE / iPAS-NZ
          </span>
        </div>

        <h1 className="cl-hero__title cl-display">
          淨零碳<em>備考</em>神器
        </h1>

        <p className="cl-hero__lead">
          iPAS 淨零碳規劃管理師考古題的開放式檔案。
          <span className="cl-hero__lead-tail">
            每題對應一條官方法源；每個答案附有可追溯的 primary-source URL；每張練習單，皆是一次小型碳審計。
          </span>
        </p>

        <hr className="cl-rule" aria-hidden="true" />

        {/* Ledger-style stat row */}
        <dl className="cl-hero__stats">
          <div className="cl-hero__stat">
            <dt className="cl-eyebrow">Q-Total</dt>
            <dd>
              <span className="cl-figure cl-hero__stat-num">{stats.total}</span>
              <span className="cl-hero__stat-unit">主題庫題</span>
            </dd>
          </div>
          <div className="cl-hero__stat">
            <dt className="cl-eyebrow">考科一</dt>
            <dd>
              <span className="cl-figure cl-hero__stat-num">{stats.subject1}</span>
              <span className="cl-hero__stat-unit">基礎概論</span>
            </dd>
          </div>
          <div className="cl-hero__stat">
            <dt className="cl-eyebrow">考科二</dt>
            <dd>
              <span className="cl-figure cl-hero__stat-num">{stats.subject2}</span>
              <span className="cl-hero__stat-unit">盤查程序</span>
            </dd>
          </div>
          <div className="cl-hero__stat cl-hero__stat--addendum">
            <dt className="cl-eyebrow">補充 / Addendum</dt>
            <dd>
              <span className="cl-figure cl-hero__stat-num">+{PRACTICE_POOL_COUNTS.total}</span>
              <span className="cl-hero__stat-unit">加強練習池</span>
            </dd>
          </div>
        </dl>

        {practiceMode.enabled && (
          <aside className="cl-hero__practice-on" role="status">
            <span className="cl-fn-marker">±</span>
            <span>
              <strong className="cl-hero__practice-label">加強練習池啟用中</strong>
              ：本場測驗將額外混入 {PRACTICE_POOL_COUNTS.total} 題（{PRACTICE_POOL_COUNTS.externalMock} 模擬 + {PRACTICE_POOL_COUNTS.aiGenerated} AI 產題；每題附來源徽章）。
              於設定頁可關閉。
            </span>
          </aside>
        )}
      </section>

      {/* WORKSHEET — 配置區 */}
      <section className="cl-worksheet" aria-labelledby="worksheet-title">
        <header className="cl-worksheet__head">
          <h2 id="worksheet-title" className="cl-worksheet__title cl-display">
            填寫今日工作單
          </h2>
          <span className="cl-eyebrow cl-worksheet__formno cl-figure">
            FORM&nbsp;/&nbsp;NZ-Q-001
          </span>
        </header>

        {/* 1. 科目選擇（卡片式） */}
        <fieldset className="cl-fieldset">
          <legend className="cl-fieldset__legend">
            <span className="cl-fn-marker">1</span>
            <span>科目範圍</span>
          </legend>
          <div className="cl-subject-cards" role="radiogroup" aria-label="考科範圍">
            {SUBJECT_OPTIONS.map((opt) => {
              const active = config.subject === opt.value;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`cl-subject-card ${active ? 'is-active' : ''}`}
                  onClick={() => pickSubject(opt.value)}
                >
                  <span className="cl-subject-card__no cl-figure">§{opt.number}</span>
                  <span className="cl-subject-card__title">
                    {opt.value === '考科1' ? '考科一' : opt.value === '考科2' ? '考科二' : opt.title}
                  </span>
                  <span className="cl-subject-card__sub">
                    {opt.value === 'all' ? '兩科一起練' : opt.title}
                  </span>
                  <span className="cl-subject-card__count cl-figure">
                    {opt.count}
                    <small>題</small>
                  </span>
                </button>
              );
            })}
          </div>
          <select
            id="subject"
            value={config.subject}
            onChange={handleSubjectChange}
            className="cl-visually-hidden"
            aria-label="考科範圍 (備援 select)"
          >
            <option value="all">全部 ({stats.total} 題)</option>
            <option value="考科1">考科一：淨零碳規劃管理基礎概論 ({stats.subject1} 題)</option>
            <option value="考科2">考科二：淨零碳盤查範圍與程序概要 ({stats.subject2} 題)</option>
          </select>
        </fieldset>

        {/* 2. 測驗模式（segmented） */}
        <fieldset className="cl-fieldset">
          <legend className="cl-fieldset__legend">
            <span className="cl-fn-marker">2</span>
            <span>測驗模式</span>
          </legend>
          <div className="cl-mode-segmented" role="radiogroup" aria-label="測驗模式">
            {MODE_OPTIONS.map((opt) => {
              const active = config.mode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`cl-mode-card ${active ? 'is-active' : ''}`}
                  onClick={() => pickMode(opt.value)}
                >
                  <span className="material-icons cl-mode-card__icon">{opt.icon}</span>
                  <span className="cl-mode-card__title">{opt.title}</span>
                  <span className="cl-mode-card__desc">{opt.desc}</span>
                </button>
              );
            })}
          </div>
          <select
            id="mode"
            value={config.mode}
            onChange={handleModeChange}
            className="cl-visually-hidden"
            aria-label="測驗模式 (備援 select)"
          >
            <option value="practice">練習模式（即時顯示答案）</option>
            <option value="exam">考試模式（最後顯示結果）</option>
          </select>
        </fieldset>

        {/* 3. 題數 + 隨機 */}
        <fieldset className="cl-fieldset cl-fieldset--row">
          <div className="cl-count-block">
            <label htmlFor="count" className="cl-fieldset__legend cl-fieldset__legend--inline">
              <span className="cl-fn-marker">3</span>
              <span>題數</span>
            </label>
            <div className="cl-count-input">
              <input
                type="number"
                id="count"
                min={1}
                max={100}
                value={config.questionCount}
                onChange={handleCountChange}
                aria-label="題數"
                className="cl-figure"
              />
              <span className="cl-count-input__unit">題 / 1–100</span>
            </div>
          </div>

          <label className="cl-shuffle-switch">
            <input
              type="checkbox"
              checked={config.shuffleQuestions}
              onChange={handleShuffleChange}
            />
            <span className="cl-shuffle-switch__track" aria-hidden="true" />
            <span className="cl-shuffle-switch__label">
              <span className="material-icons sm">shuffle</span>
              隨機出題順序
            </span>
          </label>
        </fieldset>

        {/* CTA */}
        <div className="cl-cta-row">
          <button
            type="button"
            className="cl-cta-primary"
            onClick={handleStart}
            aria-label={`開始 ${config.questionCount} 題測驗`}
          >
            <span className="cl-cta-primary__label">
              開始測驗
              <span className="cl-cta-primary__sublabel cl-figure">
                {config.questionCount} 題 · {config.mode === 'practice' ? '練習' : '考試'}
              </span>
            </span>
            <span className="material-icons cl-cta-primary__arrow">arrow_forward</span>
          </button>

          <p className="cl-cta-fineprint">
            <span className="cl-fn-marker">i</span>
            <span>
              {practiceMode.enabled
                ? `加強練習池已啟用 — 抽題範圍將包含 ${PRACTICE_POOL_COUNTS.total} 題補充題（含 AI 產題揭露徽章）。`
                : `預設僅抽自主題庫；前往「設定 → 加強練習池」可加入 ${PRACTICE_POOL_COUNTS.total} 題補充題。`}
            </span>
          </p>
        </div>
      </section>

      {/* 考科說明 — 改為兩欄 dossier */}
      <section className="cl-dossier" aria-labelledby="dossier-title">
        <h2 id="dossier-title" className="cl-eyebrow cl-section-mark">
          考科檔案 / Dossier
        </h2>
        <div className="cl-dossier__grid">
          <article className="cl-dossier__card">
            <header className="cl-dossier__card-head">
              <span className="cl-figure cl-dossier__no">§01</span>
              <h3 className="cl-dossier__card-title cl-display">考科一</h3>
            </header>
            <p className="cl-dossier__sub">淨零碳規劃管理基礎概論</p>
            <ul className="cl-dossier__list">
              <li>淨零排放國際發展與政策趨勢、CBAM、Paris Agreement Article 6</li>
              <li>永續發展與碳中和、PAS 2060 / ISO 14068-1</li>
              <li>溫室氣體基礎與 IPCC GWP（AR5/AR6）</li>
              <li>SBTi、ISSB IFRS S1/S2、TCFD</li>
            </ul>
          </article>

          <article className="cl-dossier__card">
            <header className="cl-dossier__card-head">
              <span className="cl-figure cl-dossier__no">§02</span>
              <h3 className="cl-dossier__card-title cl-display">考科二</h3>
            </header>
            <p className="cl-dossier__sub">淨零碳盤查範圍與程序概要</p>
            <ul className="cl-dossier__list">
              <li>ISO 14064-1:2018 六分類（Cat 1–6）</li>
              <li>組織邊界（營運／財務／股權控制法）</li>
              <li>排放係數與計算（環境部 113/2/5 公告 AR5 GWP）</li>
              <li>查證、CFP-PCR、碳足跡標籤</li>
            </ul>
          </article>
        </div>
      </section>
    </div>
  );
}

export default HomePage;
