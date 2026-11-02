// 星號與待複習錯題要告訴使用者的事（沒有儲存、新版資料、練習池載入失敗）。放在 App 層，每一頁都看得到；
// live region 一直在畫面上，內容換了螢幕閱讀器才會念，空的時候不佔高度。
import { useReviewNotice } from '../../hooks/useReview';
import './ReviewNotice.css';

export function ReviewNotice() {
  return (
    <p className="review-notice" role="status" aria-live="polite" aria-atomic="true">
      {useReviewNotice()}
    </p>
  );
}

export default ReviewNotice;
