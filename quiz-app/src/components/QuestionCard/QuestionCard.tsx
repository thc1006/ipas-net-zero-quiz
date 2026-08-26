// QuestionCard 元件 - 顯示單一題目和選項
import { useCallback, useId, useMemo, useState } from 'react';
import type { QuizQuestion, QuizOption } from '../../types/quiz';
import { explainQuestion, type AIResponse } from '../../utils/ai-helper';
import { AnswerEvidence } from '../AnswerEvidence/AnswerEvidence';
import { SourceBadge } from '../SourceBadge/SourceBadge';
import { SourceBanner } from '../SourceBanner/SourceBanner';
import { prettifySourceUrl } from '../../utils/source-label';
import { findRedundantPrefix } from '../../utils/option-prefix';
import { subjectClass, subjectLabel } from '../../utils/subject-label';
import { buildFeedbackUrl } from '../../utils/question-feedback-url';
import { useAllQuestionStats } from '../../hooks/useQuestionStats';
import './QuestionCard.css';

/** HTML 實體逸出 —— 這是 renderMarkdown 唯一的安全基礎。 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 簡易 Markdown 轉 HTML
 * 支援：**粗體**、*斜體*、`程式碼`、標題、清單
 *
 * **輸出會被丟進 dangerouslySetInnerHTML，而輸入來自第三方 AI 服務。**
 * 因此第一步一定是把原始 HTML 逸出掉：先前沒有這一步，模型只要回
 * `<img src=x onerror=...>`，那段 HTML 就會被瀏覽器當成標籤執行。
 * 逸出之後，唯一會出現在輸出裡的標籤是本函式自己插入的 strong / em / code。
 */
export function renderMarkdown(text: string): string {
  if (!text) return '';

  let result = escapeHtml(text)
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
  // 每題作答統計 chip（Refs #64）— 透過 useAllQuestionStats 訂閱跨 tab 變更
  // （另一分頁 clearStats / 完成 quiz 時自動 refresh），無答案題不顯示
  const allStats = useAllQuestionStats();
  const stat = useMemo(
    () => (question.hasAnswer ? allStats[question.id] ?? null : null),
    [question.id, question.hasAnswer, allStats]
  );
  const [isLoadingAI, setIsLoadingAI] = useState(false);

  // 練習池的 AI 產題也帶解析（100 題）。那些解析是模型寫的，不能和通過反捏造閘門的
  // 題庫解析共用同一個標籤 —— 標題本身就是一種背書。
  const isAiAuthoredExplanation = question.provenance?.source_type === 'ai_generated';
  const explanationLabel = isAiAuthoredExplanation ? 'AI 產題解析' : '題庫解析';

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
        <span className={`badge badge-info subject-tag ${subjectClass(question.subject)}`}>
          {subjectLabel(question.subject)}
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

      {/* 題庫解析 —— 人工／來源約束寫成，且通過反捏造閘門。
          先前完全沒有渲染：918 則解析躺在資料裡，畫面上卻只有一顆「AI 解析」按鈕，
          等於讓未經審核的生成內容取代已審核的內容。順序固定為
          答案 → 題庫解析 → 答案依據 → 參考來源 → AI 延伸。 */}
      {showAnswer && question.explanation && (
        <section
          className={`curated-explanation${
            isAiAuthoredExplanation ? ' curated-explanation--ai' : ''
          }`}
          aria-label={explanationLabel}
        >
          <div className="curated-explanation__header">
            <span className="material-icons sm" aria-hidden="true">
              menu_book
            </span>
            <span>{explanationLabel}</span>
            {isAiAuthoredExplanation && (
              <span className="curated-explanation__grade">未經人工逐題審核</span>
            )}
          </div>
          <p className="curated-explanation__body">{question.explanation}</p>
        </section>
      )}

      {/* 答案揭曉後才顯示依據與來源；順序：題庫解析 → 答案依據 → 參考來源 → AI 延伸 */}
      {showAnswer && (
        <>
        <AnswerEvidence evidence={question.evidence} />

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
        </>
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
              AI 延伸說明（未經人工審核）
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
                {/* 先前這裡渲染「信心度 85%」。那個數字來自回覆長度與關鍵詞加總，
                    與答案正確與否無關 —— 一個憑空生成卻看起來精確的百分比，
                    比不顯示更糟。改為據實說明這段內容的性質。 */}
                <span className="confidence-badge">未經人工審核</span>
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

        </div>
      )}
    </article>
  );
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

// 這支從前住在本檔；AnswerEvidence 也要用，為避免 QuestionCard ↔ AnswerEvidence
// 循環相依而搬到 utils/source-label.ts。此處 re-export 維持既有匯入點可用。
export { prettifySourceUrl } from '../../utils/source-label';
