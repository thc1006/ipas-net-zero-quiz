// 畫面上的一段到 scope 換掉之前不變矮（星號與待複習錯題，Discussion #1）。
// 使用者沒有動手、別的分頁造成的變化讓一段內容變短時，它下面的東西全部往上移；捲到最底時頁面變短，
// 瀏覽器把捲動位置往上拉，上面的東西全部往下移。兩種都會把使用者正要按的按鈕從指標底下移走。
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

interface Kept {
  el: HTMLElement | null;
  tallest: number;
}

// 畫面上所有留著高度的段落共用一個 resize listener（結果頁一張錯題卡一段，可能有上百段）
const kept = new Set<Kept>();
let width = 0;
let landscape = false;
// 使用者在設定頁換了字級（useAccessibility 寫在 html 的 data-font-size）：折行與行高都換了，跟換視窗寬度一樣從頭量。
// 其他設定（深色、高對比、色覺模式）只換顏色，不影響高度。useAccessibility 每換一個設定（包括系統換成深色）都把
// data-font-size 照原來的值再寫一次，所以比對值，不是有寫就量
let fontSize: MutationObserver | null = null;
let shownFont: string | null = null;

function onFontSize(): void {
  const now = document.documentElement.getAttribute('data-font-size');
  if (now === shownFont) return;
  shownFont = now;
  remeasure();
}

/**
 * 從現在的內容重新量每一段。先全部清掉、再全部量、最後全部寫回：
 * 一段一段做的話每量一段都要重新排版一次（寫回上一段的 min-height 之後才量下一段），上百段時一次 resize 要排版上百次
 */
function remeasure(): void {
  const shown = [...kept].filter((k): k is Kept & { el: HTMLElement } => k.el !== null);
  for (const k of shown) k.el.style.minHeight = '';
  const heights = shown.map((k) => k.el.getBoundingClientRect().height);
  shown.forEach((k, i) => {
    k.tallest = heights[i];
    k.el.style.minHeight = `${heights[i]}px`;
  });
}

function onResize(): void {
  const turned = window.innerWidth > window.innerHeight;
  // 只有高度換了（手機網址列收起來）不算
  if (window.innerWidth === width && turned === landscape) return;
  width = window.innerWidth;
  landscape = turned;
  remeasure();
}

function track(k: Kept): () => void {
  if (kept.size === 0) {
    width = window.innerWidth;
    landscape = window.innerWidth > window.innerHeight;
    window.addEventListener('resize', onResize);
    shownFont = document.documentElement.getAttribute('data-font-size');
    fontSize = new MutationObserver(onFontSize);
    fontSize.observe(document.documentElement, { attributes: true, attributeFilter: ['data-font-size'] });
  }
  kept.add(k);
  return () => {
    kept.delete(k);
    if (kept.size > 0) return;
    window.removeEventListener('resize', onResize);
    fontSize?.disconnect();
    fontSize = null;
  };
}

/**
 * 每次畫完量一次，記下最高的設成 min-height：之後換成比較短的內容時 min-height 已經在了，中間不會先變矮一次。
 * 元素不在了、scope 換了（換了一件事要說、使用者換了選項）就從頭量。
 * 視窗寬度換了、橫向直向互換、使用者換了字級時也從現在的內容重新量：折行不同，留著的是另一個寬度、另一個字級的高度，
 * 空白可能有好幾行。
 */
export function useKeepHeight(ref: RefObject<HTMLElement | null>, scope: unknown = null): void {
  const self = useRef<Kept>({ el: null, tallest: 0 });
  const shown = useRef(scope);
  useLayoutEffect(() => {
    const k = self.current;
    const el = ref.current;
    k.el = el;
    if (!el) {
      k.tallest = 0;
      return;
    }
    if (shown.current !== scope) {
      shown.current = scope;
      k.tallest = 0;
      el.style.minHeight = '';
    }
    const height = el.getBoundingClientRect().height;
    if (height > k.tallest) {
      k.tallest = height;
      el.style.minHeight = `${height}px`;
    }
  });

  useEffect(() => track(self.current), []);
}
