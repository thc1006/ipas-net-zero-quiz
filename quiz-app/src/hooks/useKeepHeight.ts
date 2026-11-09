// 畫面上的一段到 scope 換掉之前不變矮（星號與待複習錯題，Discussion #1）。
// 使用者沒有動手、別的分頁造成的變化讓一段內容變短時，它下面的東西全部往上移；捲到最底時頁面變短，
// 瀏覽器把捲動位置往上拉，上面的東西全部往下移。兩種都會把使用者正要按的按鈕從指標底下移走。
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * 每次畫完量一次，記下最高的設成 min-height：之後換成比較短的內容時 min-height 已經在了，中間不會先變矮一次。
 * 元素不在了、scope 換了（換了一件事要說、使用者換了選項）就從頭量。
 * 視窗寬度換了、橫向直向互換時也從現在的內容重新量：折行不同，留著的是另一個寬度的高度，空白可能有好幾行。
 */
export function useKeepHeight(ref: RefObject<HTMLElement | null>, scope: unknown = null): void {
  const tallest = useRef(0);
  const shown = useRef(scope);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
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

  useEffect(() => {
    let width = window.innerWidth;
    let landscape = window.innerWidth > window.innerHeight;
    const onResize = () => {
      const turned = window.innerWidth > window.innerHeight;
      // 只有高度換了（手機網址列收起來）不算
      if (window.innerWidth === width && turned === landscape) return;
      width = window.innerWidth;
      landscape = turned;
      const el = ref.current;
      if (!el) return;
      el.style.minHeight = '';
      tallest.current = el.getBoundingClientRect().height;
      el.style.minHeight = `${tallest.current}px`;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [ref]);
}
