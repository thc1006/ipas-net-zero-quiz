// 星號與待複習錯題要告訴使用者的事（沒有儲存、新版資料、練習池載入失敗）。放在 App 層，每一頁都看得到；
// live region 一直在畫面上，內容換了螢幕閱讀器才會念，空的時候不佔高度。
// 固定在視窗邊上（ReviewNotice.css），不佔版面：出現時不推動任何東西。預設在底部；剛按的東西或有焦點的元素
// 在底部會被它蓋住時改放頁首下面（placement.ts），捲動、焦點移動時重新選邊。
// 量出它蓋住多高：底部給 html 的 scroll-padding-bottom（--review-notice-cover）與頁尾的空白（--review-notice-reserve），
// 上面給 scroll-padding-top（--review-notice-cover-top，App.css）。頁尾的空白在同一個畫面裡只增不減：
// 提示收掉或換邊時頁面變短，捲在最底下的話頁面會跟著跳。
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useReviewNotice } from '../../hooks/useReview';
import { placeNotice } from './placement';
import './ReviewNotice.css';

interface ReviewNoticeProps {
  /** 現在的畫面；換畫面時頁尾的空白重新算 */
  view?: string;
}

// 點一下要能指到的東西；點在空白或文字上就不算指著什麼
const INTERACTIVE = 'button, a[href], input, select, textarea, label, summary, [tabindex]';

/** 元素在視窗裡的位置。藏起來的 radio 沒有大小，看得到的是外面的 label（題目的選項） */
function box(node: Element): DOMRect {
  const r = node.getBoundingClientRect();
  if (r.height > 0) return r;
  return node.closest('label')?.getBoundingClientRect() ?? r;
}

export function ReviewNotice({ view }: ReviewNoticeProps) {
  const text = useReviewNotice();
  const ref = useRef<HTMLParagraphElement>(null);
  const reserve = useRef(0);
  const reservedFor = useRef(view);
  // 最近按的或拿到焦點的元素：提示是它引起的，或使用者正看著它
  const anchor = useRef<Element | null>(null);
  const root = document.documentElement;

  // 提示出現之前就要記：按下星號的那一下，提示還沒出現
  useEffect(() => {
    const own = (target: EventTarget | null): target is Element =>
      target instanceof Element && !ref.current?.contains(target);
    const onPointerDown = (e: PointerEvent) => {
      if (own(e.target)) anchor.current = e.target.closest(INTERACTIVE);
    };
    const onFocusIn = (e: FocusEvent) => {
      if (own(e.target)) anchor.current = e.target;
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
    };
  }, []);

  // 換畫面與收掉提示常在同一次 render：空白要在同一個 effect 裡用這一次量到的高度重算，
  // 分成兩個 effect 的話，換畫面那一個拿到的是上一個畫面的高度
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reservedFor.current !== view) {
      reservedFor.current = view;
      reserve.current = 0;
    }
    const header = document.querySelector('.app-header');
    const place = () => {
      let coverBottom = 0;
      let coverTop = 0;
      el.style.removeProperty('top');
      el.style.removeProperty('max-height');
      el.dataset.side = 'bottom';
      if (text) {
        const viewportHeight = window.innerHeight;
        const headerBottom = Math.max(0, header?.getBoundingClientRect().bottom ?? 0);
        const natural = el.getBoundingClientRect();
        const gap = Math.max(0, viewportHeight - natural.bottom);
        const target = anchor.current?.isConnected ? box(anchor.current) : null;
        const { side, maxHeight } = placeNotice({
          viewportHeight,
          headerBottom,
          gap,
          noticeHeight: natural.height,
          anchor: target && target.height > 0 ? target : null,
        });
        if (maxHeight !== null) el.style.maxHeight = `${maxHeight}px`;
        if (side === 'top') {
          el.dataset.side = 'top';
          el.style.top = `${headerBottom + gap}px`;
        }
        const r = el.getBoundingClientRect();
        if (side === 'top') coverTop = Math.max(0, Math.ceil(r.bottom - headerBottom));
        else coverBottom = Math.max(0, Math.ceil(viewportHeight - r.top));
      }
      root.style.setProperty('--review-notice-cover', `${coverBottom}px`);
      root.style.setProperty('--review-notice-cover-top', `${coverTop}px`);
      reserve.current = Math.max(reserve.current, coverBottom);
      root.style.setProperty('--review-notice-reserve', `${reserve.current}px`);
    };
    place();
    if (!text) return;

    // 捲動與焦點移動之後再選邊：瀏覽器先把焦點捲進畫面，再看它在哪裡
    let frame = 0;
    const later = () => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          place();
        });
      }
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(later);
    observer?.observe(el);
    if (header) observer?.observe(header);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', later, { passive: true });
    document.addEventListener('focusin', later);
    document.addEventListener('pointerdown', later);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', later);
      document.removeEventListener('focusin', later);
      document.removeEventListener('pointerdown', later);
    };
  }, [text, view, root]);

  return (
    <p ref={ref} className="review-notice" role="status" aria-live="polite" aria-atomic="true">
      {text}
    </p>
  );
}

export default ReviewNotice;
