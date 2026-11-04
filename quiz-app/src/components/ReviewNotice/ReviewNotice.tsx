// 星號與待複習錯題要告訴使用者的事（Discussion #1）。都排在文件流裡，不蓋住任何東西，也不移動焦點：
// - ButtonNotice：星號、移出待複習按下去引起的（第一次加星號、沒有儲存），排在那顆按鈕那一列的正下方。
//   它上面的東西都不動，按鈕不會從指標底下移走，第二下點同一個位置還是那顆按鈕。
// - ReviewNotice：其他的（新版資料、壞資料、練習池載入失敗、結束測驗時沒有儲存），排在主內容最上面。
//   多半開頁或換畫面時就在，使用者開始操作之後不會再把內容往下推。
// 看得到的字是一般內容。螢幕閱讀器由 ReviewAnnouncer 念：插進頁面的 live region 不一定會念，
// 所以用一個開頁就在、看不見的，每一句新的提示念一次。
import { useEffect, useRef, useState } from 'react';
import { useButtonNotice, useLatestButtonNotice, useReviewNotice } from '../../hooks/useReview';
import type { ReviewButton } from '../../utils/review-storage';
import './ReviewNotice.css';

export function ReviewNotice() {
  const text = useReviewNotice();
  return text ? <p className="review-notice review-notice--page">{text}</p> : null;
}

interface ButtonNoticeProps {
  button: ReviewButton;
  questionId: string;
}

export function ButtonNotice({ button, questionId }: ButtonNoticeProps) {
  const text = useButtonNotice(button, questionId);
  return text ? <p className="review-notice">{text}</p> : null;
}

export function ReviewAnnouncer() {
  const page = useReviewNotice();
  const latest = useLatestButtonNotice();
  const [said, setSaid] = useState('');
  const seen = useRef<{ page: string | null; latest: string | null }>({ page: null, latest: null });

  // 新出現的那一句才念；念過的收掉時清空，不回頭再念還在的那一句，下次同一句出現時才念得到
  useEffect(() => {
    const before = seen.current;
    seen.current = { page, latest };
    if (latest && latest !== before.latest) setSaid(latest);
    else if (page && page !== before.page) setSaid(page);
    else if (said && said !== page && said !== latest) setSaid('');
  }, [page, latest, said]);

  return (
    <p className="review-live sr-only" role="status" aria-live="polite" aria-atomic="true">
      {said}
    </p>
  );
}

export default ReviewNotice;
