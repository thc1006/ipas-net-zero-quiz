import type { Page } from '@playwright/test';
import { expect } from './fixtures';

/**
 * 量位置時容許的誤差（px）。GitHub 的機器忙的時候，量的當下 transition、補捲與小數的捲動位置常常還差 1 到 2px，
 * 同一份程式碼在 CI 上這次紅、下次綠（#165）。使用者看不出 2px；被頁首蓋住一截、跑出視窗、整行字移動都還擋得住
 */
export const SLACK = 2;

/**
 * 等版面停下來：動畫與 transition 跑完，每個元素的位置與高度連續 150ms 沒變。機器忙的時候 ResizeObserver、
 * 補捲與 transition 晚好幾個 frame 才到，只等兩個 frame 量到的是中間的位置。最多等 3 秒，停不下來就照當下的量
 */
export const settle = (page: Page): Promise<void> =>
  page.evaluate(async () => {
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const look = () =>
      JSON.stringify([
        window.scrollY,
        ...[...document.body.querySelectorAll('*')].map((el) => {
          const r = el.getBoundingClientRect();
          return [Math.round(r.top * 10), Math.round(r.height * 10)];
        }),
      ]);
    const end = performance.now() + 3000;
    let last = '';
    let since = 0;
    while (performance.now() < end) {
      await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
      await frames();
      const now = look();
      if (now !== last) {
        last = now;
        since = performance.now();
      } else if (performance.now() - since >= 150) {
        return;
      }
    }
  });

/** 每一個數字差 SLACK 以內，其他的值一樣：取代 toEqual(before)，1 到 2px 與小數的差不算移動 */
export function expectNear<T extends object>(actual: T, expected: T, message: string): void {
  const a = actual as Record<string, unknown>;
  const e = expected as Record<string, unknown>;
  const where = `${message} ${JSON.stringify({ before: expected, after: actual })}`;
  expect(Object.keys(a), where).toEqual(Object.keys(e));
  for (const key of Object.keys(e)) {
    if (typeof e[key] === 'number') expect(Math.abs((a[key] as number) - (e[key] as number)), `${where}：${key}`).toBeLessThanOrEqual(SLACK);
    else expect(a[key], `${where}：${key}`).toEqual(e[key]);
  }
}
