// 程式把焦點放回一個控制項時（關掉開始測驗失敗的訊息、對話框關閉）：控制項可能在視窗外或 sticky 頁首底下。
// 不讓 focus() 自己捲：各引擎不一樣（WebKit 在畫面換掉的同一個 task 裡不捲，Firefox 差幾 px 到視窗底邊，
// Chromium 捲到正中間），也都不扣頁首。放好焦點之後自己捲最少的距離。

/** sticky 頁首的下緣。量頁首本身：字級剛換時 --app-header-height 還是舊的（Header.tsx 的 ResizeObserver 晚一步） */
function headerBottom(): number {
  const header = document.querySelector('.app-header');
  return header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
}

/**
 * 捲最少的距離，讓 el 露在頁首下面、視窗之內（block: 'nearest' 的捲法，頁首蓋住的那一段不算）。
 * 比可用的高度高時上緣貼頁首：焦點看得到優先（WCAG 2.4.11）。頁首裡的元素不捲（它一直在畫面上）。回傳捲了多少
 */
export function revealBelowHeader(el: Element): number {
  if (el.closest('.app-header')) return 0;
  // 藏起來的 radio 沒有大小，看得到的是外面的 label
  const shown = el.getBoundingClientRect().height > 0 ? el : (el.closest('label') ?? el);
  const top = headerBottom();
  const box = shown.getBoundingClientRect();
  const overflow = box.bottom - document.documentElement.clientHeight;
  // 捲動量取整數：Firefox 的捲動位置會進位，小數的話差一點貼不到視窗底邊、差一點被頁首蓋到
  const by =
    box.top < top ? Math.floor(box.top - top) : overflow > 0 ? Math.min(Math.ceil(overflow), Math.floor(box.top - top)) : 0;
  if (by !== 0) window.scrollBy(0, by);
  return by;
}

/** 焦點放回 el（不在畫面上、拿不到焦點就不動），再捲到看得到 */
export function returnFocus(el: HTMLElement | null | undefined): void {
  if (!el || !el.isConnected || el === document.body) return;
  el.focus({ preventScroll: true });
  if (document.activeElement === el) revealBelowHeader(el);
}
