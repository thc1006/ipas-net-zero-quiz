import { test, expect } from './fixtures';

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

// 換字級時頁首與上面的內容跟著變高或變矮，字體大小的選單會移動：之前選單捲到頁首下面時換大字級，選單被變高的頁首與
// 上面的內容推到頁首底下或視窗底邊下面（三個引擎都是）。換的當下捲回原來的位置，頁首變高蓋到的話再往下露出來
test.describe('換字級：字體大小的選單留在原來的位置，不被頁首蓋住、不跑出視窗', () => {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 412, height: 839 },
    { width: 640, height: 360 },
  ]) {
    for (const where of ['top', 'bottom'] as const) {
      test(`${viewport.width}x${viewport.height} 選單在${where === 'top' ? '頁首下面' : '視窗底邊'}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await gotoSettings(page);
        const select = page.locator('.setting-item select').first();
        await expect(select).toHaveValue('normal');
        for (const size of ['large', 'xlarge', 'large', 'normal', 'xlarge', 'normal']) {
          await select.focus();
          const before = await select.evaluate((el, where) => {
            const box = el.getBoundingClientRect();
            const header = document.querySelector('.app-header')!.getBoundingClientRect().bottom;
            window.scrollBy(0, where === 'top' ? box.top - (header + 2) : box.bottom - (document.documentElement.clientHeight - 2));
            return { top: el.getBoundingClientRect().top, scrollY: window.scrollY };
          }, where);
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
          await select.selectOption(size);
          await expect(page.locator('html')).toHaveAttribute('data-font-size', size);
          // 按鈕的 transition 跑完之後（padding 跟著字級慢慢變）再量
          await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
          const m = await select.evaluate((el) => ({
            top: el.getBoundingClientRect().top,
            bottom: el.getBoundingClientRect().bottom,
            header: document.querySelector('.app-header')!.getBoundingClientRect().bottom,
            viewport: document.documentElement.clientHeight,
          }));
          const where2 = `換成 ${size} ${JSON.stringify({ before, m })}`;
          expect(m.top, `被頁首蓋住 ${where2}`).toBeGreaterThanOrEqual(m.header - 0.5);
          expect(m.bottom, `在視窗外 ${where2}`).toBeLessThanOrEqual(m.viewport + 0.5);
          // 沒有被頁首或視窗底邊擋住時留在原來的位置。捲在最上面時換小字級，上面變矮，頁面捲不回去
          const blocked = m.top <= m.header + 1 || m.bottom >= m.viewport - 1 || (before.scrollY < 1 && m.top < before.top);
          if (!blocked) expect(Math.abs(m.top - before.top), `移動了 ${where2}`).toBeLessThanOrEqual(1);
        }
      });
    }
  }
});
