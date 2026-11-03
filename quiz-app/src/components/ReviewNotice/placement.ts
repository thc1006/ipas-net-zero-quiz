// 提示放在視窗的哪一邊。提示是因為使用者按了某個東西才出現的（星號、移出、匯入），那個東西不能被它蓋住：
// 第二下點同一個位置要點得到，鍵盤的焦點也要看得到（WCAG 2.4.11）。也不能把它推走，所以提示不佔版面，只選邊。
// 提示自己也要讀得到：至少留兩行（minHeight），不能為了讓位縮成一條線。
// 量的都是視窗座標（getBoundingClientRect）。

export type NoticeSide = 'top' | 'bottom';

export interface NoticeLayout {
  viewportHeight: number;
  /** sticky 頁首的下緣；提示放上面時排在它下面 */
  headerBottom: number;
  /** 提示與視窗邊緣（或頁首）之間的空隙 */
  gap: number;
  /** 提示不限高度時的高度 */
  noticeHeight: number;
  /** 提示至少要多高才讀得到（兩行字加上 padding 與框線）；整個提示比這矮就是整個提示 */
  minHeight: number;
  /** 不能被蓋住的元素（最近按的、有焦點的）；沒有或不在畫面上就是 null */
  anchor: { top: number; bottom: number } | null;
  /** 只是捲動或大小改變、沒有按下別的東西或移動焦點時，提示現在在哪一邊：不必換就不換 */
  stay?: NoticeSide | null;
}

export interface NoticePlacement {
  side: NoticeSide;
  /** 放不下整個提示時的高度上限（提示裡面捲動）；放得下是 null */
  maxHeight: number | null;
}

/** 兩邊都會把 anchor 整個蓋住時，至少讓它露出這麼高（WCAG 2.5.8 的最小點擊範圍），比這矮就露出整個 */
export const ANCHOR_KEEP = 24;

const overlaps = (a: { top: number; bottom: number }, top: number, bottom: number): boolean =>
  a.top < bottom && a.bottom > top;

/**
 * 只是捲動（stay）時，原本那一邊放得下至少兩行又不碰到 anchor 就不換：捲動中換邊，提示會在畫面上跳來跳去。
 * 其他情形依序試：
 * 1. 整個提示放得下又不碰到 anchor：預設底部（頁尾留了同樣高的空白，捲得到）。
 * 2. 有一邊放得下至少兩行：限制高度放空間大的那邊，提示裡面捲動。
 * 3. 兩邊都放不下兩行：提示留兩行，與 anchor 重疊，anchor 露出其餘的部分。兩行的字比 anchor 被蓋住的那一段要緊：
 *    WCAG 2.4.11 只要求有焦點的元素不被整個蓋住，提示縮成 0 的話（例如存不進去的說明）就沒有人看得到。
 *    底部優先：鍵盤按下一題時焦點在題幹，題幹從頁首下面開始，放底部蓋住的是它的後半，開頭留著。
 * 4. 連兩行都會把 anchor 整個蓋住（視窗極矮）：anchor 優先，提示縮到讓 anchor 露出 ANCHOR_KEEP。
 * 頁首與視窗邊之間放不下整個提示時也限制高度：頁首上的按鈕不能被蓋住。
 */
export function placeNotice(layout: NoticeLayout): NoticePlacement {
  const { viewportHeight: vh, headerBottom: hb, gap, noticeHeight, minHeight, anchor, stay = null } = layout;
  const room = Math.max(0, vh - hb - 2 * gap);
  const full = Math.min(noticeHeight, room);
  const least = Math.min(minHeight, full);
  const place = (side: NoticeSide, height: number): NoticePlacement => ({
    side,
    maxHeight: height < noticeHeight ? Math.max(0, Math.floor(height)) : null,
  });
  const span = (side: NoticeSide, height: number): [number, number] =>
    side === 'top' ? [hb + gap, hb + gap + height] : [vh - gap - height, vh - gap];
  const order: NoticeSide[] = stay === 'top' ? ['top', 'bottom'] : ['bottom', 'top'];

  const a = anchor && { top: Math.max(anchor.top, hb), bottom: Math.min(anchor.bottom, vh) };
  if (!a || a.bottom <= a.top) return place(stay ?? 'bottom', full);

  // 空間算到 anchor 前面再留一個 gap；只差那個 gap 的話照樣放兩行，不重疊就好
  const tight = { top: a.top - (hb + gap), bottom: vh - gap - a.bottom };
  const spare = { top: tight.top - gap, bottom: tight.bottom - gap };
  const fits = (side: NoticeSide) => !overlaps(a, ...span(side, full));
  const capped = (side: NoticeSide) => Math.min(full, Math.max(least, spare[side]));
  // 只是捲動：原本那一邊放得下至少兩行又不碰到 anchor 就留著
  if (stay && (fits(stay) || tight[stay] >= least)) return place(stay, fits(stay) ? full : capped(stay));

  // 1
  for (const side of order) if (fits(side)) return place(side, full);

  // 2
  const roomy = order.filter((side) => tight[side] >= least);
  if (roomy.length > 0) {
    const side = roomy.reduce((best, s) => (spare[s] > spare[best] ? s : best));
    return place(side, capped(side));
  }

  // 3：anchor 在頁首下面、視窗裡的部分，扣掉提示蓋住的
  const shown = (side: NoticeSide, height: number) => {
    const [top, bottom] = span(side, height);
    return a.bottom - a.top - Math.max(0, Math.min(a.bottom, bottom) - Math.max(a.top, top));
  };
  const keep = Math.min(ANCHOR_KEEP, a.bottom - a.top);
  const ok = order.find((side) => shown(side, least) >= keep);
  if (ok) return place(ok, least);

  // 4：每一邊最多能放多高還讓 anchor 露出 keep，選放得高的那邊
  const most = (side: NoticeSide) => {
    let height = Math.floor(least);
    while (height > 0 && shown(side, height) < keep) height -= 1;
    return height;
  };
  const side = order.reduce((best, s) => (most(s) > most(best) ? s : best));
  return place(side, most(side));
}
