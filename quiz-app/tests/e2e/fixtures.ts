import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * 頁尾的訪客計數器連外部服務 abacus。E2E 不能真的連過去：
 * - 回應的快慢與成敗不固定。失敗時計數器整個不顯示，頁尾矮一截；頁面捲到底時捲動位置跟著被拉回，
 *   量位置的測試就偶爾紅（practice-keyboard.spec.ts 的選項在按下滑鼠之後差 2px）。
 * - 每開一個新頁面就替正式網站的訪客人次加 1。
 * 所以每個 context 都先把計數器的請求回成固定值。spec 一律從這裡拿 test；自己開 context 的要呼叫
 * stubVisitorCounter，src/e2e-fixtures.test.ts 會檢查。
 */
export const STUB_VISITOR_COUNT = 321;

export async function stubVisitorCounter(target: BrowserContext | Page): Promise<void> {
  await target.route(/abacus\.jasoncameron\.dev/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ value: STUB_VISITOR_COUNT }),
    })
  );
}

// 第二個參數不叫 use：ESLint 的 React hooks 規則會把它當成 hook
export const test = base.extend({
  context: async ({ context }, provide) => {
    await stubVisitorCounter(context);
    await provide(context);
  },
});

export { expect };
