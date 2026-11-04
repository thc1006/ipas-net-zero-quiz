// 星號與待複習錯題要告訴使用者的事（沒有儲存、新版資料、練習池載入失敗）。放在 App 層，每一頁都看得到；
// live region 一直在畫面上，內容換了螢幕閱讀器才會念，空的時候不佔高度。
// 固定在視窗邊上（ReviewNotice.css），不佔版面：出現時不推動任何東西。預設在底部；剛按的東西或有焦點的元素
// 在底部會被它蓋住時改放頁首下面（placement.ts），焦點移動、按下別的東西時重新選邊；只是捲動的話，原本那一邊
// 還放得下就不換。兩邊都會碰到時至少留兩行字，不縮成一條線。
// 量出它蓋住多高：底部給 html 的 scroll-padding-bottom（--review-notice-cover）與頁尾的空白（--review-notice-reserve），
// 上面給 scroll-padding-top（--review-notice-cover-top，App.css）。頁尾的空白在同一個畫面裡只增不減：
// 提示收掉或換邊時頁面變短，捲在最底下的話頁面會跟著跳。
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useReviewNotice } from '../../hooks/useReview';
import { placeNotice, type NoticeSide } from './placement';
import './ReviewNotice.css';

interface ReviewNoticeProps {
  /** 現在的畫面；換畫面時頁尾的空白重新算 */
  view?: string;
}

// 點一下要能指到的東西；點在空白或文字上就不算指著什麼。tabindex 是負的（題幹）只是讓程式移焦點過去，
// 看起來是文字，點了雖然會拿到焦點，也不算
const INTERACTIVE = 'button, a[href], input, select, textarea, label, summary, [tabindex]:not([tabindex^="-"])';

/** 焦點是不是用鍵盤移過去的（或鍵盤操作之後由程式移過去的）；不支援 :focus-visible 就當作是 */
function focusVisible(node: Element): boolean {
  try {
    return node.matches(':focus-visible');
  } catch {
    return true;
  }
}

/** 元素在視窗裡的位置。藏起來的 radio 沒有大小，看得到的是外面的 label（題目的選項） */
function box(node: Element): DOMRect {
  const r = node.getBoundingClientRect();
  if (r.height > 0) return r;
  return node.closest('label')?.getBoundingClientRect() ?? r;
}

/**
 * 提示不限高度、放在底部時的位置。量的是一個看不見的複本，提示本身不動：拿掉它的 max-height 再放回去，
 * 裡面捲到的位置會歸零，寫回 scrollTop 又會打斷還沒停的平滑捲動（WebKit 用方向鍵捲提示時停在半路）
 */
function naturalBox(el: HTMLElement): DOMRect {
  const copy = el.cloneNode(true) as HTMLElement;
  for (const name of ['role', 'aria-live', 'aria-atomic', 'tabindex', 'data-side', 'style']) copy.removeAttribute(name);
  copy.setAttribute('aria-hidden', 'true');
  copy.style.visibility = 'hidden';
  el.after(copy);
  const r = copy.getBoundingClientRect();
  copy.remove();
  return r;
}

export function ReviewNotice({ view }: ReviewNoticeProps) {
  const text = useReviewNotice();
  const ref = useRef<HTMLParagraphElement>(null);
  const reserve = useRef(0);
  const reservedFor = useRef(view);
  // 最近按的或拿到焦點的元素：提示是它引起的，或使用者正看著它
  const anchor = useRef<Element | null>(null);
  // anchor 換過（或重新按了同一個）之後還沒選過邊：這一次照預設選，不留在原本那一邊
  const fresh = useRef(true);
  // 提示拿到焦點之前有焦點的元素：提示有焦點時字收掉，焦點回到這裡
  const cameFrom = useRef<HTMLElement | null>(null);
  const root = document.documentElement;

  // 提示出現之前就要記：按下星號的那一下，提示還沒出現。換掉它的只有用鍵盤把焦點移到別的元素，或按了別的能按的東西：
  // 點在文字或空白上不算，觸控捲動也不算（從按鈕或選項上開始捲的話，瀏覽器送 pointercancel，不會有 pointerup），
  // 所以按下時先記著，放開才換。點下去拿到的焦點由 pointerup 決定，focusin 只管 :focus-visible 的焦點：
  // 點題幹的文字時題幹拿到焦點，但它不是剛按的東西。剛按的東西不見了、焦點移到取代它的元素時（移出待複習之後的
  // 「已移出」、關掉對話框回到打開它的按鈕），就換成那個元素
  useEffect(() => {
    const own = (target: EventTarget | null): target is Element =>
      target instanceof Element && !ref.current?.contains(target);
    let pressed: { pointerId: number; target: Element } | null = null;
    const onPointerDown = (e: PointerEvent) => {
      const target = own(e.target) ? e.target.closest(INTERACTIVE) : null;
      pressed = target && { pointerId: e.pointerId, target };
    };
    const onPointerUp = (e: PointerEvent) => {
      if (pressed?.pointerId === e.pointerId) {
        anchor.current = pressed.target;
        fresh.current = true;
      }
      pressed = null;
    };
    const onPointerCancel = () => {
      pressed = null;
    };
    const onFocusIn = (e: FocusEvent) => {
      if (e.target === ref.current) {
        cameFrom.current = e.relatedTarget instanceof HTMLElement ? e.relatedTarget : null;
        return;
      }
      if (own(e.target) && (focusVisible(e.target) || anchor.current?.isConnected === false)) {
        anchor.current = e.target;
        fresh.current = true;
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerCancel, true);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerCancel, true);
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
      const stay = fresh.current ? null : el.dataset.side === 'top' ? 'top' : 'bottom';
      fresh.current = false;
      let side: NoticeSide = 'bottom';
      let top = '';
      let maxHeight = '';
      const viewportHeight = window.innerHeight;
      const headerBottom = Math.max(0, header?.getBoundingClientRect().bottom ?? 0);
      if (text) {
        const natural = naturalBox(el);
        const gap = Math.max(0, viewportHeight - natural.bottom);
        const target = anchor.current?.isConnected ? box(anchor.current) : null;
        // 讀得到的最少高度：兩行字加上下的 padding 與框線（box-sizing 是 border-box，max-height 含這些）
        const cs = getComputedStyle(el);
        const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.6;
        const frame = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'] as const;
        const minHeight = Math.ceil(2 * line + frame.reduce((sum, k) => sum + (parseFloat(cs[k]) || 0), 0));
        const placed = placeNotice({
          viewportHeight,
          headerBottom,
          gap,
          noticeHeight: natural.height,
          minHeight,
          anchor: target && target.height > 0 ? target : null,
          stay,
        });
        side = placed.side;
        if (placed.maxHeight !== null) maxHeight = `${placed.maxHeight}px`;
        if (side === 'top') top = `${headerBottom + gap}px`;
      }
      // 沒變的不寫：提示裡的捲動還沒停時，任何一次重寫都可能讓它停在半路
      if (el.dataset.side !== side) el.dataset.side = side;
      if (el.style.top !== top) el.style.top = top;
      if (el.style.maxHeight !== maxHeight) el.style.maxHeight = maxHeight;
      if (text) {
        const r = el.getBoundingClientRect();
        if (side === 'top') coverTop = Math.max(0, Math.ceil(r.bottom - headerBottom));
        else coverBottom = Math.max(0, Math.ceil(viewportHeight - r.top));
      }
      // 放不下、裡面要捲動時，鍵盤也要到得了：WebKit 的捲動區沒有 tabindex 就拿不到焦點。放得下就拿掉，
      // 不多一個 Tab 停留點（焦點在它上面時先留著，等焦點離開）
      if (text && el.scrollHeight > el.clientHeight + 1) {
        if (el.getAttribute('tabindex') !== '0') el.tabIndex = 0;
      } else if (el.hasAttribute('tabindex') && (!text || document.activeElement !== el)) {
        // 提示有焦點時字收掉（另一個分頁換了資料）：拿掉 tabindex 焦點會掉到 body，先回到進提示之前的元素
        if (document.activeElement === el && cameFrom.current?.isConnected) cameFrom.current.focus();
        el.removeAttribute('tabindex');
      }
      reserve.current = Math.max(reserve.current, coverBottom);
      for (const [name, px] of [
        ['--review-notice-cover', coverBottom],
        ['--review-notice-cover-top', coverTop],
        ['--review-notice-reserve', reserve.current],
      ] as const) {
        if (root.style.getPropertyValue(name) !== `${px}px`) root.style.setProperty(name, `${px}px`);
      }
    };
    // 新的提示（或換了畫面）照預設選邊，從開頭讀起
    fresh.current = true;
    el.scrollTop = 0;
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
    document.addEventListener('pointerup', later);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', later);
      document.removeEventListener('focusin', later);
      document.removeEventListener('pointerup', later);
    };
  }, [text, view, root]);

  return (
    <p ref={ref} className="review-notice" role="status" aria-live="polite" aria-atomic="true">
      {text}
    </p>
  );
}

export default ReviewNotice;
