// 畫面上的一段到 scope 換掉之前不變矮（星號與待複習錯題，Discussion #1）。
// 使用者沒有動手、別的分頁造成的變化讓一段內容變短時，它下面的東西全部往上移；捲到最底時頁面變短，
// 瀏覽器把捲動位置往上拉，上面的東西全部往下移。兩種都會把使用者正要按的按鈕從指標底下移走。
import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * 每次畫完量一次，記下最高的設成 min-height：之後換成比較短的內容時 min-height 已經在了，中間不會先變矮一次。
 * 元素不在了、scope 換了（換了一件事要說、使用者換了選項）就從頭量。active 是 false 時不管。
 */
export function useKeepHeight(ref: RefObject<HTMLElement | null>, scope: unknown = null, active = true): void {
  const tallest = useRef(0);
  const shown = useRef(scope);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) {
      tallest.current = 0;
      return;
    }
    if (shown.current !== scope) {
      shown.current = scope;
      tallest.current = 0;
      el.style.minHeight = '';
    }
    const height = el.getBoundingClientRect().height;
    if (height > tallest.current) {
      tallest.current = height;
      el.style.minHeight = `${height}px`;
    }
  });
}
