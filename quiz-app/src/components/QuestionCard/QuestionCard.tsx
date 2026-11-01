// QuestionCard 元件 - 顯示單一題目和選項
import { useCallback, useId, useMemo, useState } from 'react';
import type { QuizQuestion, QuizOption } from '../../types/quiz';
import { explainQuestion, type AIResponse } from '../../utils/ai-helper';
import { AnswerEvidence } from '../AnswerEvidence/AnswerEvidence';
import { SourceBadge } from '../SourceBadge/SourceBadge';
import { SourceBanner } from '../SourceBanner/SourceBanner';
import { prettifySourceUrl } from '../../utils/source-label';
import { officialExamLabel, officialSampleLabel } from '../../utils/official-exam';
import { findRedundantPrefix } from '../../utils/option-prefix';
import { subjectClass, subjectLabel } from '../../utils/subject-label';
import { buildFeedbackUrl } from '../../utils/feedback-url';
import { useAllQuestionStats } from '../../hooks/useQuestionStats';
import { renderMarkdown } from '../../utils/render-markdown';
import './QuestionCard.css';

export interface QuestionCardProps {
  question: QuizQuestion;
  questionNumber: number;
  selectedAnswer?: string | null;
  showAnswer?: boolean;
  onSelectAnswer: (answer: string) => void;
  /**
   * 選了就鎖定的模式（練習模式）才傳。有傳時方向鍵只移動，Enter 或空白鍵才作答，作答後呼叫它：
   * 原生 radio 的方向鍵會連帶選取，第一下就交卷；選項鎖定後變 disabled，焦點留在上面會掉到 body。
   */
  onKeyboardAnswered?: () => void;
}

/** 方向鍵移動的方向（與原生 radio 相同：上左往前、下右往後，頭尾相接） */
const ARROW_STEP: Record<string, number> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
};

export function QuestionCard({
  question,
  questionNumber,
  selectedAnswer = null,
  showAnswer = false,
  onSelectAnswer,
  onKeyboardAnswered,
}: QuestionCardProps) {
  const labelId = useId();
  // 方向鍵移到、還沒確認的選項。焦點離開選項群組就清掉：沒確認的選項不能看起來像答過
  const [movedTo, setMovedTo] = useState<string | null>(null);
  const [keyboardInOptions, setKeyboardInOptions] = useState(false);
  const shownAnswer = selectedAnswer ?? movedTo;
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

  // 解析的標題本身就是一種背書，所以它要說出**這段字是誰寫的**。
  //
  //   ai_generated（100 題）  模型寫的
  //   external_mock（54 題）  第三方模擬題作者寫的，隨題一起匯入
  //   主題庫                  本題庫撰寫，逐則過 tools/explanation_guard.py
  //                           （只准用該題已機械驗證的逐字引文，不得引入引文以外的
  //                            條號／標準編號／百分比／年份／數量）
  //
  // 先前只分「AI」與「題庫解析」兩種，等於把外部模擬題的解析也掛上本題庫的名義 ——
  // 那 54 則從來沒有過我們的閘門。SourceBadge 標的是**題目**來源，這裡標的是**解析**
  // 作者，兩者不同：題目是模擬題、解析卻可能是我們寫的（反之亦然）。
  const explanationSource = question.provenance?.source_type;
  const isAiAuthoredExplanation = explanationSource === 'ai_generated';
  const isExternalExplanation = explanationSource === 'external_mock';
  const explanationLabel = isAiAuthoredExplanation
    ? 'AI 產題解析'
    : isExternalExplanation
      ? '外部模擬題解析'
      : '題庫解析';
  const explanationCaveat = isAiAuthoredExplanation
    ? '未經人工逐題審核'
    : isExternalExplanation
      ? '第三方撰寫，非本題庫'
      : null;

  const getOptionStatus = useCallback(
    (optionKey: string): 'default' | 'selected' | 'correct' | 'incorrect' => {
      if (!showAnswer) {
        return shownAnswer === optionKey ? 'selected' : 'default';
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
    [showAnswer, selectedAnswer, shownAnswer, question.answer]
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
    (e: React.KeyboardEvent<HTMLInputElement>, optionKey: string) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleOptionClick(optionKey);
        onKeyboardAnswered?.();
        return;
      }
      const step = ARROW_STEP[e.key];
      if (!onKeyboardAnswered || !step) return;
      e.preventDefault();
      // 加 Alt／Ctrl／Meta 也要攔下：WebKit 照樣點下一個選項，放行就直接交卷。代價是焦點在選項上時 Alt+左 不能上一頁
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const inputs = Array.from(
        e.currentTarget.closest('[role="radiogroup"]')?.querySelectorAll('input') ?? []
      );
      const next = inputs[(inputs.indexOf(e.currentTarget) + step + inputs.length) % inputs.length];
      setMovedTo(next.value);
      next.focus({ preventScroll: true });
    },
    [handleOptionClick, onKeyboardAnswered]
  );

  // 提示只給鍵盤：滑鼠點選項時選項也會拿到焦點，那一下不能閃出提示
  // radio 高度 0，瀏覽器只保一條線進視窗，整個選項可能還在固定的 header 底下
  const handleOptionsFocus = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    if (!e.target.matches(':focus-visible')) return;
    setKeyboardInOptions(true);
    e.target.closest('.option-item')?.scrollIntoView({ block: 'nearest' });
  }, []);

  const handleOptionsBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setMovedTo(null);
    setKeyboardInOptions(false);
  }, []);

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
        {/* 官方公告試題與參考樣題（#128 的官方題模式之前，先在題卡上標出來）。圖示用中性的機構圖示：
            verified 在題庫相似題裡代表「正確答案」，而且官方答案本身也標了時效，不該暗示「已驗證」 */}
        {question.officialExam && (
          <span className="badge badge-success official-exam-tag">
            <span className="material-icons sm" aria-hidden="true">
              account_balance
            </span>
            {officialExamLabel(question.officialExam)}
          </span>
        )}
        {question.officialSample && (
          <span className="badge badge-success official-exam-tag">
            <span className="material-icons sm" aria-hidden="true">
              account_balance
            </span>
            {officialSampleLabel(question.officialSample)}
          </span>
        )}
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
      {/* tabIndex：鍵盤按下一題時焦點移到這裡 */}
      <div
        className={`question-stem${onKeyboardAnswered ? ' question-stem--keyboard-hint' : ''}`}
        id={labelId}
        tabIndex={-1}
      >
        <p>{question.stem}</p>
      </div>

      {/* 常駐的 live region：內容變動才會念。放在選項上方，矮視窗才看得到 */}
      {onKeyboardAnswered && (
        <p role="status" className="option-keyboard-hint">
          {!showAnswer && (keyboardInOptions || movedTo) && <span>按 Enter 或空白鍵確認答案</span>}
        </p>
      )}

      {/* 選項 */}
      <div
        className="question-options"
        role="radiogroup"
        aria-labelledby={labelId}
        onFocus={onKeyboardAnswered && handleOptionsFocus}
        onBlur={onKeyboardAnswered && handleOptionsBlur}
      >
        {question.options.map((option) => (
          <OptionButton
            key={option.key}
            option={option}
            status={getOptionStatus(option.key)}
            isSelected={shownAnswer === option.key}
            isDisabled={showAnswer}
            commitOnClick={!!onKeyboardAnswered}
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
          }${isExternalExplanation ? ' curated-explanation--external' : ''}`}
          aria-label={explanationLabel}
        >
          <div className="curated-explanation__header">
            <span className="material-icons sm" aria-hidden="true">
              menu_book
            </span>
            <span>{explanationLabel}</span>
            {explanationCaveat && (
              <span className="curated-explanation__grade">{explanationCaveat}</span>
            )}
          </div>
          <p
            className="curated-explanation__body"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(question.explanation) }}
          />
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

/** 受控的 radio 一定要有 onChange，React 才不會警告 */
const noop = () => {};

// 選項按鈕子元件
interface OptionButtonProps {
  option: QuizOption;
  status: 'default' | 'selected' | 'correct' | 'incorrect';
  isSelected: boolean;
  isDisabled: boolean;
  /** 點了就作答：方向鍵移到的選項已經是 checked，再點不會有 change，要看 click */
  commitOnClick: boolean;
  /** 全選項共有的冗餘前綴關鍵字（例如「GRI」），UI 渲染時 dim 化 */
  redundantPrefix?: string | null;
  onClick: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

function OptionButton({
  option,
  status,
  isSelected,
  isDisabled,
  commitOnClick,
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
        onChange={commitOnClick ? noop : onClick}
        onClick={commitOnClick ? onClick : undefined}
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
      {/* 選了、還沒揭曉：實心圓點，不只靠顏色（#148）。radio 本身已是 checked，報讀不必再念一次 */}
      {status === 'selected' && <span className="option-selected-mark" aria-hidden="true" />}
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
