// 星號與待複習錯題要告訴使用者的事（沒有儲存、新版資料、練習池載入失敗）。放在 App 層，每一頁都看得到；
// live region 一直在畫面上，內容換了螢幕閱讀器才會念，空的時候不佔高度。
// 固定在視窗底部（ReviewNotice.css）：量出它蓋住視窗底部多高，給捲動（--review-notice-cover）與頁尾的空白
// （--review-notice-reserve）用。空白在同一個畫面裡只增不減：提示收掉時頁面變短，捲在最底下的話頁面會跟著跳。
import { useLayoutEffect, useRef } from 'react';
import { useReviewNotice } from '../../hooks/useReview';
import './ReviewNotice.css';

interface ReviewNoticeProps {
  /** 現在的畫面；換畫面時頁尾的空白重新算 */
  view?: string;
}

export function ReviewNotice({ view }: ReviewNoticeProps) {
  const text = useReviewNotice();
  const ref = useRef<HTMLParagraphElement>(null);
  const reserve = useRef(0);
  const cover = useRef(0);
  const root = document.documentElement;

  useLayoutEffect(() => {
    reserve.current = cover.current;
    root.style.setProperty('--review-notice-reserve', `${reserve.current}px`);
  }, [view, root]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      cover.current = text ? Math.max(0, Math.ceil(window.innerHeight - el.getBoundingClientRect().top)) : 0;
      root.style.setProperty('--review-notice-cover', `${cover.current}px`);
      if (cover.current > reserve.current) {
        reserve.current = cover.current;
        root.style.setProperty('--review-notice-reserve', `${reserve.current}px`);
      }
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [text, root]);

  return (
    <p ref={ref} className="review-notice" role="status" aria-live="polite" aria-atomic="true">
      {text}
    </p>
  );
}

export default ReviewNotice;
