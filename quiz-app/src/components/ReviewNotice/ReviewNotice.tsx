// 星號與待複習錯題要告訴使用者的事（Discussion #1）。都排在文件流裡，不蓋住任何東西，也不移動焦點：
// - ButtonNotice：星號、移出待複習按下去引起的（第一次加星號、沒有儲存），排在那顆按鈕那一列的正下方。
//   它上面的東西都不動，按鈕不會從指標底下移走，第二下點同一個位置還是那顆按鈕。
// - ReviewNotice：其他的（新版資料、壞資料、練習池載入失敗、結束測驗時沒有儲存），排在主內容最上面。
//   多半開頁或換畫面時就在，使用者開始操作之後不會再把內容往下推。
// 看得到的字是一般內容。螢幕閱讀器由 ReviewAnnouncer 念：插進頁面的 live region 不一定會念，
// 所以用一個開頁就在、看不見的。每一次新的提示都念，字一樣也念；提示收掉時清空（announce.ts）。
import { useEffect, useState } from 'react';
import { useButtonNotice, useReviewNotice } from '../../hooks/useReview';
import type { ReviewButton } from '../../utils/review-storage';
import { announce, attachLiveRegion, withdraw } from './announce';
import './ReviewNotice.css';

/** 這一次的提示念給螢幕閱讀器：event 換了就是新的一次；收掉或換成下一次時清空 */
function useAnnounce(text: string | null, event: unknown): void {
  const [owner] = useState(() => ({}));
  useEffect(() => {
    if (!text) return;
    announce(owner, text);
    return () => withdraw(owner);
  }, [owner, text, event]);
}

export function ReviewNotice() {
  const text = useReviewNotice();
  useAnnounce(text, text);
  return text ? <p className="review-notice review-notice--page">{text}</p> : null;
}

interface ButtonNoticeProps {
  button: ReviewButton;
  questionId: string;
}

export function ButtonNotice({ button, questionId }: ButtonNoticeProps) {
  const notice = useButtonNotice(button, questionId);
  useAnnounce(notice?.text ?? null, notice?.seq);
  return notice ? <p className="review-notice">{notice.text}</p> : null;
}

/** 字不經過 React：由 announce.ts 直接改，清空與放字才是兩次 DOM 變動 */
export function ReviewAnnouncer() {
  return <p ref={attachLiveRegion} className="review-live sr-only" role="status" aria-live="polite" aria-atomic="true" />;
}

export default ReviewNotice;
