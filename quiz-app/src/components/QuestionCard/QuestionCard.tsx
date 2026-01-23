// QuestionCard 元件 - 顯示單一題目和選項
import { useCallback, useId, useState } from 'react';
import type { QuizQuestion, QuizOption } from '../../types/quiz';
import { explainQuestion, type AIResponse } from '../../utils/ai-helper';
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
      </header>

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
  onClick: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

function OptionButton({
  option,
  status,
  isSelected,
  isDisabled,
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
      <span className="option-text">{option.text}</span>
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
