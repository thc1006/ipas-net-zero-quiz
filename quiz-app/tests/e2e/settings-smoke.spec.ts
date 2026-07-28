import { test, expect } from '@playwright/test';

/**
 * Settings 頁的跨瀏覽器 smoke（chromium + firefox + webkit）。
 *
 * 動機：PR #108 把 `<select>` 改為 appearance:none + data-URI SVG chevron，理由正是
 * 「原生箭頭跨瀏覽器位置不一致」；但全套 E2E 只跑 Chromium。這支 smoke 專門在 Firefox
 * 與 WebKit 上驗自訂 select 與色覺模式的核心行為（不把整套 E2E 乘三）。
 * Firefox/WebKit 只跑本檔（playwright.config 的 testMatch）。
 */
async function gotoSettings(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('practice-pool-disclosure-seen', '1');
  });
  await page.goto('/');
  await page.getByRole('button', { name: '開啟設定' }).click();
}

test.describe('Settings 跨瀏覽器 smoke', () => {
  test('色覺模式 select 自訂樣式 + 換色 + 預覽文字可讀', async ({ page }) => {
    await gotoSettings(page);

    const select = page.getByLabel('色覺辨認模式');
    await expect(select).toBeVisible();

    // select 高度要合理 —— WebKit 對 appearance:none 的 <select> 高度/文字垂直位置歷來較
    // 敏感（正是本 PR 改自訂樣式要顧的點）。抓 bounding box 擋「塌成 0 / 撐爆」的跨瀏覽器破圖。
    const box = await select.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThan(28);
    expect(box!.height).toBeLessThan(60);

    // 自訂 chevron（data-URI SVG）取代原生箭頭 —— Firefox/WebKit 也要能渲染出來。
    // 用 background-image 有無 svg 判定（比 computed `appearance` 跨瀏覽器可靠）。
    const bgImage = await select.evaluate(
      (el) => getComputedStyle(el).backgroundImage
    );
    expect(bgImage).toContain('svg');

    // 預覽 chip 文字用可讀前景（text-primary），不是語意綠 rgb(76,175,80) —— 對比修正
    // 跨瀏覽器都要成立。
    const chip = page.locator('.cvd-preview__chip--correct');
    await expect(chip).toBeVisible();
    const chipColor = await chip.evaluate((el) => getComputedStyle(el).color);
    expect(chipColor).not.toContain('76, 175, 80');

    // 功能：切「綠色盲」→ 語意色 token 換色（poll 容忍 style recalc 一拍延遲）。
    await select.selectOption('deuteranopia');
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--color-success')
            .trim()
            .toLowerCase()
        )
      )
      .toBe('#0288d1');
  });
});
