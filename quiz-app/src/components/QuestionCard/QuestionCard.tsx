// QuestionCard 元件 - 顯示單一題目和選項
import { useCallback, useId, useMemo, useState } from 'react';
import type { QuizQuestion, QuizOption } from '../../types/quiz';
import { explainQuestion, type AIResponse } from '../../utils/ai-helper';
import { SourceBadge } from '../SourceBadge/SourceBadge';
import { SourceBanner } from '../SourceBanner/SourceBanner';
import { LAW_PCODE_LABELS } from '../../data/law-pcode-labels';
import { findRedundantPrefix } from '../../utils/option-prefix';
import { buildFeedbackUrl } from '../../utils/question-feedback-url';
import { loadStats } from '../../utils/question-stats-storage';
import './QuestionCard.css';

/**
 * 簡易 Markdown 轉 HTML
 * 支援：**粗體**、*斜體*、`程式碼`、標題、清單
 */
function renderMarkdown(text: string): string {
  if (!text) return '';

  let result = text
    // 標題 ### text 或 ## text
    .replace(/^###\s+(.+)$/gm, '<strong>$1</strong>')
    .replace(/^##\s+(.+)$/gm, '<strong>$1</strong>')
    // 粗體 **text** 或 __text__（支援跨空格）
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    // 行內程式碼 `code`
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // 清單項目 - item（轉為 bullet point）
    .replace(/^[-•]\s+/gm, '• ')
    // 數字清單 1. item
    .replace(/^\d+\.\s+/gm, '• ');

  // 斜體 *text*（在粗體處理後，避免衝突）
  // 只匹配單個星號包圍的文字，且不在單詞中間
  result = result.replace(/(?:^|[\s>])(\*[^*\n]+\*)(?:[\s<]|$)/g, (match, p1) => {
    const inner = p1.slice(1, -1);
    return match.replace(p1, `<em>${inner}</em>`);
  });

  return result;
}

export interface QuestionCardProps {
  question: QuizQuestion;
  questionNumber: number;
  selectedAnswer?: string | null;
  showAnswer?: boolean;
  onSelectAnswer: (answer: string) => void;
}

export function QuestionCard({
  question,
  questionNumber,
  selectedAnswer = null,
  showAnswer = false,
  onSelectAnswer,
}: QuestionCardProps) {
  const labelId = useId();
  const [aiResponse, setAiResponse] = useState<AIResponse | null>(null);
  const sourceLabels = useMemo(
    () =>
      (question.sources ?? []).map((url) => ({ url, label: prettifySourceUrl(url) })),
    [question.sources]
  );
  const redundantPrefix = useMemo(
    () => findRedundantPrefix(question.stem, question.options.map((o) => o.text)),
    [question.stem, question.options],
  );
  // 每題作答統計 chip（Refs #64）— 只在 mount 時 / question.id 變動時讀
  // 一次 localStorage，不隨 selectedAnswer 等狀態 re-render 重讀
  const stat = useMemo(() => {
    if (!question.hasAnswer) return null;
    const s = loadStats()[question.id];
    return s ?? null;
  }, [question.id, question.hasAnswer]);
  const [isLoadingAI, setIsLoadingAI] = useState(false);

  const getOptionStatus = useCallback(
    (optionKey: string): 'default' | 'selected' | 'correct' | 'incorrect' => {
      if (!showAnswer) {
        return selectedAnswer === optionKey ? 'selected' : 'default';
      }

      // 顯示答案模式
      if (question.answer === optionKey) {
        return 'correct';
      }
      if (selectedAnswer === optionKey && selectedAnswer !== question.answer) {
        return 'incorrect';
      }
      return 'default';
    },
    [showAnswer, selectedAnswer, question.answer]
  );

  const handleOptionClick = useCallback(
    (optionKey: string) => {
      if (!showAnswer) {
        onSelectAnswer(optionKey);
      }
    },
    [showAnswer, onSelectAnswer]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, optionKey: string) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleOptionClick(optionKey);
      }
    },
    [handleOptionClick]
  );

  // 請求 AI 解釋
  const handleAskAI = useCallback(async () => {
    if (isLoadingAI) return;

    setIsLoadingAI(true);
    setAiResponse(null);

    try {
      const response = await explainQuestion(question);
      setAiResponse(response);
    } catch {
      setAiResponse({
        success: false,
        content: '',
        confidence: 0,
        error: '請求失敗，請稍後再試',
      });
    } finally {
      setIsLoadingAI(false);
    }
  }, [question, isLoadingAI]);

  return (
    <article className="question-card card animate-slide-up">
      {/* 題目標頭 */}
      <header className="question-header">
        <span className="question-number">第 {questionNumber} 題</span>
        <span className={`badge badge-info subject-tag subject-${question.subject === '考科1' ? '1' : '2'}`}>
          {question.subject === '考科1' ? '考科一' : '考科二'}
        </span>
        {question.provenance && (
          <SourceBadge
            sourceType={question.provenance.source_type}
            qualityFlags={question.qualityFlags ?? []}
          />
        )}
        {/* 個人作答歷史 chip（Refs #64）— 只在有標準答案的題目顯示
            stat.attempts > 0 雙重保險：storage validator 已拒絕 attempts<1，
            這裡再 guard 避免任何漏網路徑導致 NaN%（Copilot PR #80） */}
        {question.hasAnswer && (
          <span className="question-stat-chip" data-testid="question-stat-chip">
            {stat && stat.attempts > 0 ? (
              <>
                答對率 {Math.round((stat.correct / stat.attempts) * 100)}%
                <span className="question-stat-chip__count">（{stat.attempts} 次）</span>
              </>
            ) : (
              '新題目'
            )}
          </span>
        )}
        {/* 回報此題（Refs #63）— 開新分頁不打斷答題 flow；icon-only 但有 aria-label */}
        <a
          className="question-feedback-link"
          href={buildFeedbackUrl({
            questionId: question.id,
            stem: question.stem,
            fromPage: 'quiz',
          })}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="回報此題的問題"
          title="此題有問題？回報維護者"
        >
          <span className="material-icons sm" aria-hidden="true">
            flag
          </span>
        </a>
      </header>

      {/* 練習池來源 banner — 主題庫題不顯示 */}
      {question.provenance && (
        <SourceBanner
          sourceType={question.provenance.source_type}
          qualityFlags={question.qualityFlags ?? []}
          sourceCount={question.sources?.length ?? 0}
        />
      )}

      {/* 題幹 */}
      <div className="question-stem" id={labelId}>
        <p>{question.stem}</p>
      </div>

      {/* 選項 */}
      <div
        className="question-options"
        role="radiogroup"
        aria-labelledby={labelId}
      >
        {question.options.map((option) => (
          <OptionButton
            key={option.key}
            option={option}
            status={getOptionStatus(option.key)}
            isSelected={selectedAnswer === option.key}
            isDisabled={showAnswer}
            redundantPrefix={redundantPrefix}
            onClick={() => handleOptionClick(option.key)}
            onKeyDown={(e) => handleKeyDown(e, option.key)}
          />
        ))}
      </div>

      {/* 無答案提示 */}
      {showAnswer && !question.hasAnswer && (
        <div className="no-answer-notice">
          <span className="material-icons sm">info</span>
          <span>此題目無標準答案，僅供練習參考</span>
        </div>
      )}

      {/* AI 解析區 */}
      {showAnswer && (
        <div className="ai-section">
          {!aiResponse && !isLoadingAI && (
            <button
              className="btn btn-secondary ai-explain-btn"
              onClick={handleAskAI}
              disabled={isLoadingAI}
            >
              <span className="material-icons">smart_toy</span>
              AI 解析
            </button>
          )}

          {isLoadingAI && (
            <div className="ai-loading">
              <span className="material-icons rotating">sync</span>
              <span>AI 分析中...</span>
            </div>
          )}

          {aiResponse && (
            <div className={`ai-response ${aiResponse.success ? 'success' : 'error'}`}>
              <div className="ai-response-header">
                <span className="material-icons">smart_toy</span>
                <span>AI 解析</span>
                {aiResponse.confidence > 0 && (
                  <span className="confidence-badge">
                    信心度 {Math.round(aiResponse.confidence * 100)}%
                  </span>
                )}
              </div>
              {aiResponse.success ? (
                <div className="ai-response-content">
                  {aiResponse.content.split('\n').map((line, i) => (
                    <p
                      key={i}
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(line) }}
                    />
                  ))}
                </div>
              ) : (
                <div className="ai-response-error">
                  <span className="material-icons">error_outline</span>
                  <span>{aiResponse.error}</span>
                </div>
              )}
            </div>
          )}

          {question.sources && question.sources.length > 0 && (
            <div className="question-sources" aria-label="參考來源">
              <div className="question-sources-header">
                <span className="material-icons sm">menu_book</span>
                <span>參考來源</span>
              </div>
              <ul className="question-sources-list">
                {sourceLabels.map(({ url, label }) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="source-link"
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/** 將 URL 轉成短而可讀的標籤；export 供測試使用 */
export function prettifySourceUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (host.includes('law.moj.gov.tw')) {
      const pcode = u.searchParams.get('pcode');
      const flno = u.searchParams.get('flno');
      const name = pcode && LAW_PCODE_LABELS[pcode] ? LAW_PCODE_LABELS[pcode] : '法規';
      return flno ? `${name} §${flno}` : name;
    }
    if (host.includes('eur-lex.europa.eu')) {
      const celex = u.searchParams.get('uri') || '';
      // CELEX 格式：3{year}R{number}，第一碼 3=legal acts；strip leading zeros from number
      const m = celex.match(/3(\d{4})R(\d+)/);
      if (m) {
        const year = m[1];
        const num = m[2].replace(/^0+/, '') || '0';
        return `EU Reg ${year}/${num}`;
      }
      return 'EUR-Lex';
    }
    if (host.includes('ipcc.ch')) return 'IPCC';
    if (host.includes('iso.org')) return 'ISO';
    if (host.includes('cca.gov.tw')) return '環境部 氣候變遷署';
    if (host.includes('moenv.gov.tw')) return '環境部';
    if (host.includes('greentrade.org.tw')) return '綠色貿易資訊網';
    if (host.includes('cdp.net')) return 'CDP';
    if (host.includes('vocus.cc')) return 'vocus 文章';
    if (host.includes('github.com')) {
      // 細分 path：discussions / issues / pulls / 其他
      if (u.pathname.includes('/discussions/')) return 'GitHub Discussion';
      if (u.pathname.includes('/issues/')) return 'GitHub Issue';
      if (u.pathname.includes('/pull/')) return 'GitHub PR';
      return 'GitHub';
    }
    return host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// 選項按鈕子元件
interface OptionButtonProps {
  option: QuizOption;
  status: 'default' | 'selected' | 'correct' | 'incorrect';
  isSelected: boolean;
  isDisabled: boolean;
  /** 全選項共有的冗餘前綴關鍵字（例如「GRI」），UI 渲染時 dim 化 */
  redundantPrefix?: string | null;
  onClick: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

function OptionButton({
  option,
  status,
  isSelected,
  isDisabled,
  redundantPrefix,
  onClick,
  onKeyDown,
}: OptionButtonProps) {
  const statusClass = status !== 'default' ? status : '';

  return (
    <label
      className={`option-item ${statusClass}`}
      data-testid={`option-${option.key}`}
    >
      <input
        type="radio"
        name="quiz-option"
        value={option.key}
        checked={isSelected}
        disabled={isDisabled}
        onChange={onClick}
        onKeyDown={onKeyDown}
        aria-label={`${option.key}: ${option.text}`}
      />
      <span className="option-key">{option.key}</span>
      <span className="option-text">
        {redundantPrefix && option.text.startsWith(redundantPrefix) ? (
          <>
            <span className="option-text__redundant" aria-hidden="true">
              {redundantPrefix}
            </span>
            {option.text.slice(redundantPrefix.length)}
          </>
        ) : (
          option.text
        )}
      </span>
      {status === 'correct' && (
        <span className="option-icon material-icons" aria-label="正確答案">
          check_circle
        </span>
      )}
      {status === 'incorrect' && (
        <span className="option-icon material-icons" aria-label="錯誤">
          cancel
        </span>
      )}
    </label>
  );
}

export default QuestionCard;
