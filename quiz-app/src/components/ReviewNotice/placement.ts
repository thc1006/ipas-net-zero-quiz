// 提示放在視窗的哪一邊。提示是因為使用者按了某個東西才出現的（星號、移出、匯入），那個東西不能被它蓋住：
// 第二下點同一個位置要點得到，鍵盤的焦點也要看得到（WCAG 2.4.11）。也不能把它推走，所以提示不佔版面，只選邊。
// 量的都是視窗座標（getBoundingClientRect）。

export interface NoticeLayout {
  viewportHeight: number;
  /** sticky 頁首的下緣；提示放上面時排在它下面 */
  headerBottom: number;
  /** 提示與視窗邊緣（或頁首）之間的空隙 */
  gap: number;
  /** 提示不限高度時的高度 */
  noticeHeight: number;
  /** 不能被蓋住的元素（最近按的、有焦點的）；沒有或不在畫面上就是 null */
  anchor: { top: number; bottom: number } | null;
}

export interface NoticePlacement {
  side: 'top' | 'bottom';
  /** 兩邊都放不下整個提示時的高度上限（提示裡面捲動）；放得下是 null */
  maxHeight: number | null;
}

const overlaps = (a: { top: number; bottom: number }, top: number, bottom: number): boolean =>
  a.top < bottom && a.bottom > top;

/**
 * 預設放底部（頁尾留了同樣高的空白，捲得到）；底部會蓋住 anchor 才放上面，兩邊都會蓋住就放空間大的那邊、限制高度。
 * 頁首與視窗邊之間放不下整個提示時也限制高度：頁首上的按鈕不能被蓋住
 */
export function placeNotice({ viewportHeight, headerBottom, gap, noticeHeight, anchor }: NoticeLayout): NoticePlacement {
  const room = viewportHeight - headerBottom - 2 * gap;
  const height = Math.min(noticeHeight, room);
  const fit = (side: 'top' | 'bottom'): NoticePlacement => ({
    side,
    maxHeight: noticeHeight > room ? Math.max(0, Math.floor(room)) : null,
  });
  const visible = anchor && anchor.bottom > headerBottom && anchor.top < viewportHeight ? anchor : null;
  if (!visible || !overlaps(visible, viewportHeight - gap - height, viewportHeight)) return fit('bottom');
  const topTop = headerBottom + gap;
  if (!overlaps(visible, headerBottom, topTop + height)) return fit('top');
  const above = visible.top - topTop - gap;
  const below = viewportHeight - gap - (visible.bottom + gap);
  return above > below
    ? { side: 'top', maxHeight: Math.max(0, Math.floor(above)) }
    : { side: 'bottom', maxHeight: Math.max(0, Math.floor(below)) };
}
