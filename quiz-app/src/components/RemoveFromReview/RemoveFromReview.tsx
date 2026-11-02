// 手動移出待複習；題卡（答案揭曉後）與結果頁錯題卡共用，順便說還差幾次移出。
import { useEffect, useRef, useState } from 'react';
import { useReview } from '../../hooks/useReview';
import {
  REVIEW_REMOVE_STREAK,
  removeFromReview,
  wrongEntry,
  type ReviewWrongEntry,
} from '../../utils/review-storage';
import './RemoveFromReview.css';

/**
 * 作答要等結束測驗才記錄，題卡上存著的 streak 還不含剛才這一題，所以要依這次的對錯算。
 * answeredCorrectly 沒給（結果頁，已經記錄過了）就照存著的說。
 */
function progressText(entry: ReviewWrongEntry, answeredCorrectly?: boolean): string | null {
  if (answeredCorrectly === false) return `要連續答對 ${REVIEW_REMOVE_STREAK} 次`;
  const streak = entry.streak + (answeredCorrectly ? 1 : 0);
  if (streak >= REVIEW_REMOVE_STREAK) return '這場結束會移出';
  return streak > 0 ? `再答對 ${REVIEW_REMOVE_STREAK - streak} 次移出` : null;
}

interface RemoveFromReviewProps {
  questionId: string;
  /** 這一題剛才答對了嗎；還沒記錄的作答才要給 */
  answeredCorrectly?: boolean;
}

export function RemoveFromReview({ questionId, answeredCorrectly }: RemoveFromReviewProps) {
  const entry = wrongEntry(useReview(), questionId);
  const [removed, setRemoved] = useState(false);
  const doneRef = useRef<HTMLParagraphElement>(null);

  // 按鈕消失時焦點會掉回 body，鍵盤使用者要從頁首重新走一次
  useEffect(() => {
    if (removed) doneRef.current?.focus();
  }, [removed]);

  if (!entry) {
    if (!removed) return null;
    return (
      <p ref={doneRef} className="review-remove__done" tabIndex={-1}>
        已移出待複習
      </p>
    );
  }

  const progress = progressText(entry, answeredCorrectly);
  return (
    <div className="review-remove">
      {progress && <span className="review-remove__progress">{progress}</span>}
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setRemoved(removeFromReview(questionId))}
      >
        移出待複習
      </button>
    </div>
  );
}

export default RemoveFromReview;
