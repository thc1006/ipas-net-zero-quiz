import { chromium, firefox, type Page } from '@playwright/test';
import { test, expect, stubVisitorCounter, STUB_VISITOR_COUNT } from './fixtures';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 瀏覽器封鎖 Cookie 與網站資料時，連讀 window.localStorage／sessionStorage 這兩個屬性都會丟 SecurityError，
 * 沒有接住的那一次會讓整頁變白。stub 三個引擎都驗；Chromium 與 Firefox 另外用真的封鎖設定跑一次。
 */

const storageErrors = (page: Page) =>
  page.evaluate(() =>
    (['localStorage', 'sessionStorage'] as const).map((name) => {
      try {
        void window[name];
        return `${name}：讀得到`;
      } catch (e) {
        return (e as Error).name;
      }
    })
  );

/** 整條路走一次：首頁、對話框、測驗、結果、設定，都不能丟錯，訪客計數也要顯示 */
async function walkThrough(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  expect(await storageErrors(page)).toEqual(['SecurityError', 'SecurityError']);

  // 先斷言看得到：白頁時要紅在這裡，不是等 click 逾時
  await expect(page.getByRole('button', { name: '暫不啟用' })).toBeVisible();
  await page.getByRole('button', { name: '暫不啟用' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('淨零碳');
  await expect(page.getByLabel(`訪客人次：${STUB_VISITOR_COUNT}`)).toBeVisible();

  await page.locator('#count').fill('1');
  await page.getByRole('button', { name: /開始測驗/ }).click();
  await page.locator('.option-item').first().click();
  await expect(page.locator('.option-item.correct')).toHaveCount(1);
  await page.getByRole('button', { name: /完成測驗/ }).click();
  await expect(page.locator('.score-value')).toBeVisible();

  await page.getByRole('button', { name: '開啟設定' }).click();
  await page.getByRole('button', { name: '重置為預設值' }).click();
  await expect(page.getByText(/^外觀$/)).toBeVisible();

  expect(errors).toEqual([]);
}

test('讀 localStorage、sessionStorage 都丟 SecurityError：頁面照常可用', async ({ page }) => {
  await page.addInitScript(() => {
    for (const name of ['localStorage', 'sessionStorage']) {
      Object.defineProperty(window, name, {
        get() {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
      });
    }
  });

  await walkThrough(page);
});

test('Firefox 的封鎖設定：封鎖所有 Cookie，頁面照常可用', async ({ browserName, baseURL }) => {
  test.skip(browserName !== 'firefox', 'firefoxUserPrefs 只有 Firefox 有');
  const browser = await firefox.launch({
    firefoxUserPrefs: { 'network.cookie.cookieBehavior': 2 },
  });
  try {
    const context = await browser.newContext({ baseURL });
    // 自己開的 context 沒有經過 fixtures.ts 的 test，計數器要自己擋
    await stubVisitorCounter(context);
    const page = await context.newPage();

    await walkThrough(page);
  } finally {
    await browser.close();
  }
});

test('Chromium 的封鎖設定：封鎖所有 Cookie，頁面照常可用', async ({
  browserName,
  baseURL,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '設定檔格式只有 Chromium 認得');
  const profile = testInfo.outputPath('profile');
  mkdirSync(join(profile, 'Default'), { recursive: true });
  writeFileSync(
    join(profile, 'Default', 'Preferences'),
    JSON.stringify({ profile: { default_content_setting_values: { cookies: 2 } } })
  );
  // headless shell 不讀使用者設定檔，要完整的 Chromium
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', baseURL });
  try {
    // 自己開的 context 沒有經過 fixtures.ts 的 test，計數器要自己擋（擋整個 context，已經開著的分頁也算）
    await stubVisitorCounter(context);
    const page = context.pages()[0] ?? (await context.newPage());

    await walkThrough(page);
  } finally {
    await context.close();
  }
});
