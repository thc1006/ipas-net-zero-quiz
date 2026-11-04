// 念給螢幕閱讀器的那一句：.review-live（ReviewAnnouncer）的字由這裡直接改，不經過 React 的 render。
// - 每一次新的提示都先清空、下一個 frame 再放字。字跟上一次一樣時 DOM 沒有變動，螢幕閱讀器不會再念：
//   第二題又存不進去、同一顆星號再按一次又存不進去，都要再念一次。
// - 字記在說它的那個提示上（owner）。那個提示收掉（換題、換畫面、同一顆按鈕的下一次寫入成功）就清空，
//   不留一句畫面上已經沒有的話；別的提示收掉不動它。
let region: HTMLElement | null = null;
let owner: object | null = null;
let frame = 0;

export function attachLiveRegion(el: HTMLElement | null): void {
  region = el;
}

function clear(): void {
  cancelAnimationFrame(frame);
  frame = 0;
  if (region?.textContent) region.textContent = '';
}

export function announce(who: object, text: string): void {
  clear();
  owner = who;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (region) region.textContent = text;
  });
}

export function withdraw(who: object): void {
  if (owner !== who) return;
  owner = null;
  clear();
}
