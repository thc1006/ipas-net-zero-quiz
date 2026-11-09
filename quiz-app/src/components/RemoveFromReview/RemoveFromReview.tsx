// 手動移出待複習；題卡（答案揭曉後）與結果頁錯題卡共用，順便說還差幾次移出。
import { useLayoutEffect, useRef, useState } from 'react';
import { useReview } from '../../hooks/useReview';
import { useKeepHeight } from '../../hooks/useKeepHeight';
import { ButtonNotice } from '../ReviewNotice/ReviewNotice';
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
  /** 同一頁有好幾顆時要分得出題目（結果頁的錯題卡）；要包含看得到的「移出待複習」 */
  label?: string;
}

/**
 * 有沒有這一列在畫出來時就定了（結果頁的錯題卡、題卡上答案揭曉的那一題；題卡換題時重新畫）。之後名單變了
 * （按下去移出、別的分頁移出或加回來）都在同一個元素裡換字，高度留在它最高的時候：一列冒出來、消失或變矮，
 * 它下面的東西全部移動，使用者正要按的按鈕從指標底下移走。畫出來時不在清單上的，之後被加進來也不加一列。
 */
export function RemoveFromReview({ questionId, answeredCorrectly, label }: RemoveFromReviewProps) {
  const entry = wrongEntry(useReview(), questionId);
  const [removed, setRemoved] = useState(false);
  const [listed] = useState(() => entry !== undefined);
  const rowRef = useRef<HTMLDivElement>(null);
  // 這一列裡最後拿到焦點的元素；焦點離開這一列就清掉
  const focused = useRef<HTMLElement | null>(null);
  // 按下去移出了：焦點跟到已移出那一行（滑鼠點的、按鈕沒有拿到焦點的瀏覽器也一樣）
  const removing = useRef(false);
  useKeepHeight(rowRef, questionId);

  // 有焦點的元素換掉了（按鈕換成字、字換成按鈕）：焦點掉回 body，鍵盤使用者要從頁首重新走一次。
  // 移到這一列換上來的那一個；在畫出來之前移，同一個位置
  useLayoutEffect(() => {
    const row = rowRef.current;
    const last = focused.current;
    const active = document.activeElement;
    const lost = last !== null && !last.isConnected && (!active || active === document.body);
    if (!row || !(removing.current || lost)) return;
    removing.current = false;
    row.querySelector<HTMLElement>('button, [tabindex="-1"]')?.focus({ preventScroll: true });
  });

  if (!listed) return null;
  const progress = entry && progressText(entry, answeredCorrectly);
  return (
    <>
      <div
        ref={rowRef}
        className="review-remove"
        onFocus={(e) => {
          focused.current = e.target;
        }}
        onBlur={(e) => {
          // 元素被換掉時不會走到這裡（拿掉的元素的事件不會傳到 React）：這裡是使用者自己把焦點移走
          if (!e.currentTarget.contains(e.relatedTarget)) focused.current = null;
        }}
      >
        {entry ? (
          <>
            {progress && <span className="review-remove__progress">{progress}</span>}
            <button
              type="button"
              className="btn btn-secondary"
              aria-label={label}
              onClick={() => {
                const done = removeFromReview(questionId);
                removing.current = done;
                setRemoved(done);
              }}
            >
              移出待複習
            </button>
          </>
        ) : removed ? (
          <p className="review-remove__done" tabIndex={-1}>
            已移出待複習
          </p>
        ) : (
          // 焦點從按鈕換過來時要停得住
          <span className="review-remove__progress" tabIndex={-1}>
            已不在待複習清單上
          </span>
        )}
      </div>
      {/* 存不進去的說明到換題、換畫面之前都在：別的分頁把同一題移出了也一樣 */}
      <ButtonNotice button="remove" questionId={questionId} />
    </>
  );
}

export default RemoveFromReview;
