// 結果頁「題庫相似題」單題：顯示題幹與選項，選取後揭曉答案
import {
  useCallback,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
} from 'react';
import type { QuizQuestion, QuizOption } from '../../types/quiz';
import { findRedundantPrefix } from '../../utils/option-prefix';
import '../QuestionCard/QuestionCard.css';
import './BankSimilarQuestionItem.css';

export interface BankSimilarQuestionItemProps {
  question: QuizQuestion;
  /** 列表序號（1-based） */
  index: number;
}

function SimilarOptionRow({
  option,
  status,
  isSelected,
  isDisabled,
  redundantPrefix,
  radioName,
  onPick,
}: {
  option: QuizOption;
  status: 'default' | 'selected' | 'correct' | 'incorrect';
  isSelected: boolean;
  isDisabled: boolean;
  redundantPrefix: string | null;
  radioName: string;
  onPick: (key: QuizOption['key']) => void;
}) {
  const statusClass = status !== 'default' ? status : '';

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!isDisabled) onPick(option.key);
      }
    },
    [isDisabled, onPick, option.key]
  );

  return (
    <label
      className={`option-item bank-similar-option ${statusClass}`}
      data-testid={`bank-similar-option-${option.key}`}
    >
      <input
        type="radio"
        name={radioName}
        value={option.key}
        checked={isSelected}
        disabled={isDisabled}
        onChange={() => !isDisabled && onPick(option.key)}
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

export function BankSimilarQuestionItem({
  question,
  index,
}: BankSimilarQuestionItemProps) {
  const labelId = useId();
  // radio group name 綁 useId 而非 question.id：同一相似題若同時出現在多個
  // 展開的錯題面板，各實例 radio 不會併入同一原生 group 而互相取消勾選
  const radioGroupName = `bank-similar-${labelId}`;
  const [picked, setPicked] = useState<string | null>(null);
  const revealed = picked !== null;

  const redundantPrefix = useMemo(() => {
    const optionTexts = question.options?.map((o) => o.text) ?? [];
    return findRedundantPrefix(question.stem, optionTexts);
  }, [question.stem, question.options]);

  const getOptionStatus = useCallback(
    (optionKey: string): 'default' | 'selected' | 'correct' | 'incorrect' => {
      if (!revealed) return 'default';

      const correct = question.answer;
      if (!question.hasAnswer || correct === null) {
        return picked === optionKey ? 'selected' : 'default';
      }

      if (optionKey === correct) return 'correct';
      if (picked === optionKey && picked !== correct) return 'incorrect';
      return 'default';
    },
    [revealed, picked, question.answer, question.hasAnswer]
  );

  const handlePick = useCallback((key: QuizOption['key']) => {
    setPicked(key);
  }, []);

  const correctAnswer = question.answer;
  const isCorrectPick =
    revealed &&
    question.hasAnswer &&
    correctAnswer !== null &&
    picked === correctAnswer;

  if (!question.options?.length) {
    return (
      <li className="bank-similar-item">
        <span className="similar-index">{index}.</span>
        <div className="similar-content">
          <p className="similar-stem">{question.stem}</p>
          <p className="bank-similar-no-options">此題無選項資料</p>
          <div className="similar-meta">
            <span className="similar-subject">
              {question.subject === '考科1' ? '考科一' : '考科二'}
            </span>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="bank-similar-item">
      <span className="similar-index">{index}.</span>
      <div className="similar-content">
        <p className="similar-stem" id={labelId}>
          {question.stem}
        </p>
        <div className="similar-meta similar-meta--top">
          <span className="similar-subject">
            {question.subject === '考科1' ? '考科一' : '考科二'}
          </span>
        </div>

        <div
          className="question-options bank-similar-options"
          role="radiogroup"
          aria-labelledby={labelId}
        >
          {question.options.map((option) => (
            <SimilarOptionRow
              key={option.key}
              option={option}
              status={getOptionStatus(option.key)}
              isSelected={picked === option.key}
              isDisabled={revealed}
              redundantPrefix={redundantPrefix}
              radioName={radioGroupName}
              onPick={handlePick}
            />
          ))}
        </div>

        {revealed && (
          <div
            className="bank-similar-reveal"
            role="status"
            aria-live="polite"
            data-testid="bank-similar-reveal"
          >
            {!question.hasAnswer || correctAnswer === null ? (
              <p className="bank-similar-reveal-text muted">
                <span className="material-icons sm">info</span>
                此題題庫未標示標準答案；您選擇了 <strong>{picked}</strong>
              </p>
            ) : (
              <>
                <p className="bank-similar-reveal-text">
                  <span className="material-icons sm">verified</span>
                  正確答案：<strong>{correctAnswer}</strong>
                  {isCorrectPick ? (
                    <span className="bank-similar-result ok"> — 答對了</span>
                  ) : (
                    <span className="bank-similar-result bad">
                      {' '}
                      — 您選擇了 {picked}
                    </span>
                  )}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export default BankSimilarQuestionItem;
