// 按鈕引起的說明在視窗外時怎麼捲出來（ReviewNotice.tsx 的 ButtonNotice、結果頁再測一次的說明）

/** sticky 頁首的高度（Header.tsx 量出來的 --app-header-height）：視窗最上面這一段被它蓋住 */
export function headerHeight(): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-header-height')) || 0;
}

/**
 * 沒有生效的說明在視窗外時，捲最少的距離讓它露出來（block: 'nearest' 的捲法，頁首蓋住的那一段不算）。
 * 往下捲時剛按的那顆按鈕（說明上面那一列裡有焦點的，沒有就是那一列的按鈕）不捲到頁首底下：
 * 兩個放不進同一個視窗時（320x256 字級特大的錯題卡，題幹那一列比視窗高），按鈕停在頁首下緣，說明露出放得下的部分。
 * 焦點看得到優先（WCAG 2.4.11）。
 */
export function revealBelowButton(el: HTMLElement): void {
  const header = headerHeight();
  const box = el.getBoundingClientRect();
  if (box.top < header) {
    // 說明在頁首底下：往上捲，它上面的按鈕跟著往下，不會被蓋住
    window.scrollBy(0, Math.floor(box.top - header));
    return;
  }
  const overflow = box.bottom - document.documentElement.clientHeight;
  if (overflow <= 0) return;
  const row = el.previousElementSibling;
  const active = document.activeElement;
  const pressed = row && active && active !== document.body && row.contains(active) ? active : row?.querySelector('button');
  // 捲動量取整數：Firefox 的捲動位置會進位，小數的話說明差一點貼不到視窗底邊、按鈕差一點被頁首蓋到
  const room = pressed ? Math.floor(pressed.getBoundingClientRect().top - header) : Infinity;
  const by = Math.min(Math.ceil(overflow), room);
  if (by > 0) window.scrollBy(0, by);
}
