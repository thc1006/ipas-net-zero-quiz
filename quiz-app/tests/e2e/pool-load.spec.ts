import type { Locator, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures';

/**
 * 練習池是另一個 chunk，部署新版後舊分頁載不到舊檔名，網路斷線時也載不到。
 * 真的擋掉那個檔案：dynamic import 失敗後能不能重試各引擎不同，mock 看不到。
 */

const POOL_CHUNK = /assets\/practice_pool-.*\.js$/;

async function seedPoolEnabled(page: Page, extra: Record<string, string> = {}): Promise<void> {
  await page.addInitScript((seeded) => {
    window.localStorage.setItem('practice-pool-disclosure-seen', '1');
    window.localStorage.setItem('practice-pool-enabled', '1');
    window.localStorage.setItem('practice-pool-ai-opt-in', '1');
    for (const [key, value] of Object.entries(seeded)) window.localStorage.setItem(key, value);
  }, extra);
}

const SAVED_THREE_QUESTIONS = JSON.stringify({
  version: 2,
  savedAt: 1,
  state: {
    isActive: true,
    questions: ['gist-1', 'gist-2', 'gist-3'],
    currentIndex: 0,
    answers: [],
    startTime: 1,
    config: {
      mode: 'practice',
      subject: 'all',
      questionCount: 3,
      shuffleQuestions: false,
      showAnswerImmediately: true,
    },
  },
});

async function failStart(page: Page): Promise<void> {
  await page.route(POOL_CHUNK, (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: /開始測驗/ }).click();
  await expect(page.getByRole('alert')).toContainText('題目載入失敗');
}

test('載不到：留在原頁，訊息在視窗內，排在文件流裡，蓋不到任何東西', async ({ page }) => {
  await seedPoolEnabled(page);
  await page.setViewportSize({ width: 320, height: 568 }); // 開始按鈕在頁面下方
  await failStart(page);

  const alert = page.getByRole('alert');
  await expect(alert).toBeInViewport();
  await expect(page.locator('.question-card')).toHaveCount(0);
  await expect(alert).toHaveCSS('position', 'static');
  // header 固定在上面，訊息不能捲到它底下
  const [header, message] = await Promise.all([
    page.locator('.app-header').boundingBox(),
    alert.boundingBox(),
  ]);
  expect(message!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
});

test('網路恢復後不重新載入，再按一次開始就能開始', async ({ page }) => {
  await seedPoolEnabled(page);
  await failStart(page);

  await page.unroute(POOL_CHUNK);
  await page.getByRole('button', { name: /開始測驗/ }).click();

  await expect(page.locator('.question-card')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

/** 擋住 chunk，放行前請求一直掛著；回傳放行的函式 */
async function holdChunk(page: Page, how: 'abort' | 'continue'): Promise<() => void> {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(POOL_CHUNK, async (route) => {
    await held;
    await (how === 'abort' ? route.abort() : route.continue());
  });
  return release;
}

test('載入中去設定頁，之後失敗：訊息不出現在設定頁，焦點不被搶走', async ({ page }) => {
  await seedPoolEnabled(page);
  const release = await holdChunk(page, 'abort');
  await page.goto('/');
  await page.getByRole('button', { name: /開始測驗/ }).click();

  const settings = page.getByRole('button', { name: '開啟設定' });
  await settings.click();
  await expect(page.getByText(/^外觀$/)).toBeVisible();
  const back = page.getByRole('button', { name: /返回/ }).first();
  await back.focus();
  release();

  await page.waitForTimeout(300); // 失敗要有時間走完，否則下面的斷言還沒等到就過了
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(back).toBeFocused();
});

test('載入中按繼續測驗，之後載入成功：續作的那一場不被換掉', async ({ page }) => {
  await seedPoolEnabled(page, { 'ipas-quiz-in-progress-v2': SAVED_THREE_QUESTIONS });
  const release = await holdChunk(page, 'continue');
  await page.goto('/');
  await page.getByRole('button', { name: /開始測驗/ }).click();

  await page.getByRole('button', { name: /繼續測驗/ }).click();
  await expect(page.getByText('1 / 3')).toBeVisible();
  release();

  await page.waitForTimeout(300); // 成功要有時間走完
  await expect(page.getByText('1 / 3')).toBeVisible();
});

test('結果頁再測一次失敗：留在結果頁，焦點在再試一次，按 Enter 不會失去結果', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('practice-pool-disclosure-seen', '1');
  });
  await page.route(POOL_CHUNK, (route) => route.abort());
  await page.goto('/');
  await page.locator('#count').fill('1');
  await page.getByRole('button', { name: /開始測驗/ }).click();
  await page.locator('.option-item').first().click();
  await page.getByRole('button', { name: /完成測驗/ }).click();
  await expect(page.locator('.score-value')).toBeVisible();
  await page.evaluate(() => {
    window.localStorage.setItem('practice-pool-enabled', '1');
    window.localStorage.setItem('practice-pool-ai-opt-in', '1');
    window.dispatchEvent(new StorageEvent('storage', { key: 'practice-pool-enabled', newValue: '1' }));
  });

  await page.getByRole('button', { name: '再測一次' }).click();
  const retry = page.getByRole('alert').getByRole('button', { name: '再試一次' });
  await expect(retry).toBeFocused();
  await expect(page.getByRole('alert')).toContainText('重新載入會清掉這份結果');

  await page.keyboard.press('Enter');
  await expect(page.locator('.score-value')).toBeVisible();
  await expect(page.getByRole('alert').getByRole('button', { name: '再試一次' })).toBeFocused();

  await page.unroute(POOL_CHUNK);
  await page.keyboard.press('Enter');
  await expect(page.locator('.question-card')).toBeVisible();
});

test('重新載入按鈕有用：重新載入後可以開始', async ({ page }) => {
  await seedPoolEnabled(page);
  await failStart(page);

  await page.unroute(POOL_CHUNK);
  await page.getByRole('alert').getByRole('button', { name: '重新載入' }).click();

  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: /開始測驗/ }).click();
  await expect(page.locator('.question-card')).toBeVisible();
});

test('訊息可以關閉', async ({ page }) => {
  await seedPoolEnabled(page);
  await failStart(page);

  await page.getByRole('alert').getByRole('button', { name: '關閉' }).click();

  await expect(page.getByRole('alert')).toHaveCount(0);
});

/** 有焦點的元素與 sticky 頁首下緣、視窗底邊 */
const focusBox = (page: Page) =>
  page.evaluate(() => {
    const box = document.activeElement!.getBoundingClientRect();
    return {
      top: box.top,
      bottom: box.bottom,
      header: document.querySelector('.app-header')!.getBoundingClientRect().bottom,
      viewport: document.documentElement.clientHeight,
    };
  });

/**
 * 用鍵盤走到關閉、按 Enter：焦點回到按下開始的按鈕。按鈕在頁面下方、訊息在最上面，訊息拿掉之後按鈕還在視窗下面。
 * 捲最少的距離：下緣貼視窗底邊，不捲到正中間
 */
async function closeByKeyboard(page: Page, opener: Locator): Promise<void> {
  const alert = page.getByRole('alert');
  await expect(alert.getByRole('button', { name: '再試一次' })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(alert.getByRole('button', { name: '關閉' })).toBeFocused();
  const before = await opener.evaluate((el, alertBox) => el.getBoundingClientRect().top - alertBox, (await alert.boundingBox())!.height);
  expect(before, '前提：訊息拿掉之後按鈕還在視窗下面').toBeGreaterThan(page.viewportSize()!.height);
  await page.keyboard.press('Enter');
  await expect(alert).toHaveCount(0);
  await expect(opener).toBeFocused();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const m = await focusBox(page);
  expect(m.top, `被頁首蓋住 ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(m.header - 0.5);
  expect(m.bottom, `在視窗外 ${JSON.stringify(m)}`).toBeLessThanOrEqual(m.viewport + 0.5);
  expect(m.bottom, `捲的不是最少的距離 ${JSON.stringify(m)}`).toBeGreaterThan(m.viewport - 1.5);
}

// 之前焦點交給 focus() 自己捲：WebKit 在訊息拿掉的同一個 task 裡不捲（1280x720 時開始測驗停在 810 到 850，視窗只到 720），
// Chromium 捲到正中間
for (const viewport of [
  { width: 1280, height: 720 },
  { width: 839, height: 412 },
]) {
  test(`${viewport.width}x${viewport.height} 用鍵盤關閉訊息：焦點回到開始測驗，在頁首下面、視窗之內`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await seedPoolEnabled(page);
    await page.route(POOL_CHUNK, (route) => route.abort());
    await page.goto('/');
    const start = page.getByRole('button', { name: /開始測驗/ });
    await start.focus();
    await page.keyboard.press('Enter');
    await closeByKeyboard(page, start);
  });
}

test('839x412 結果頁用鍵盤關閉訊息：焦點回到再測一次，在頁首下面、視窗之內', async ({ page }) => {
  await page.setViewportSize({ width: 839, height: 412 });
  await page.addInitScript(() => {
    window.localStorage.setItem('practice-pool-disclosure-seen', '1');
  });
  await page.route(POOL_CHUNK, (route) => route.abort());
  await page.goto('/');
  await page.locator('#count').fill('3');
  await page.getByRole('button', { name: /開始測驗/ }).click();
  for (let i = 0; i < 3; i++) {
    await page.locator('.option-item').first().click();
    await page.getByRole('button', { name: i < 2 ? /下一題/ : /完成測驗/ }).click();
  }
  await expect(page.locator('.score-value')).toBeVisible();
  await page.evaluate(() => {
    window.localStorage.setItem('practice-pool-enabled', '1');
    window.localStorage.setItem('practice-pool-ai-opt-in', '1');
    window.dispatchEvent(new StorageEvent('storage', { key: 'practice-pool-enabled', newValue: '1' }));
  });
  const retry = page.getByRole('button', { name: '再測一次' });
  await retry.focus();
  await page.keyboard.press('Enter');
  await closeByKeyboard(page, retry);
});

test('訊息不會跟到續作的測驗頁，下一題按得到', async ({ page }) => {
  await seedPoolEnabled(page, { 'ipas-quiz-in-progress-v2': SAVED_THREE_QUESTIONS });
  await failStart(page);

  await page.getByRole('button', { name: /繼續測驗/ }).click();

  await expect(page.locator('.question-card')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: /下一題/ }).click();
  await expect(page.getByText('第 2 題')).toBeVisible();
});

test('停用加強練習池：訊息收起', async ({ page }) => {
  await seedPoolEnabled(page);
  await failStart(page);

  await page.getByRole('button', { name: '停用加強練習池' }).click();

  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('換頁：訊息不跟著走，回來也不會再出現', async ({ page }) => {
  await seedPoolEnabled(page);
  await failStart(page);

  await page.getByRole('button', { name: '開啟設定' }).click();
  await expect(page.getByText(/^外觀$/)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.getByRole('button', { name: /返回/ }).first().click();
  await expect(page.locator('#source')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

// 星號題的名單上有練習池題，開始時練習池才載不到：這一場先出主題庫的題目，說明排在題目頁最上面。
// 載入失敗在開始的途中回報，題目頁晚一個 render 才換上來：中間那一次不能把它當成別的分頁造成的、排在首頁最後面
test('星號題開始時練習池載不到：說明只在題目頁最上面，首頁的最後面一次都沒有出現', async ({ page }) => {
  const readJson = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf-8'));
  const bank = readJson('../../src/data/integrated_dataset.json').gist_items as { index: number }[];
  const pool = readJson('../../src/data/practice_pool.json').items as { id: string }[];
  await page.route(POOL_CHUNK, (route) => route.abort());
  await page.addInitScript(
    ({ value }) => {
      window.localStorage.setItem('practice-pool-disclosure-seen', '1');
      if (!window.localStorage.getItem('ipas-review-v1')) window.localStorage.setItem('ipas-review-v1', value);
      const w = window as unknown as { __ends: string[] };
      w.__ends = [];
      document.addEventListener('DOMContentLoaded', () => {
        new MutationObserver(() => {
          const end = document.querySelector('.review-notice--end');
          if (end) w.__ends.push(`${document.querySelector('.quiz-page') ? '題目頁' : '首頁'}：${end.textContent}`);
        }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      });
    },
    {
      value: JSON.stringify({ v: 1, seeded: true, stars: { [`gist-${bank[0].index}`]: 1, [pool[0].id]: 1 }, wrong: {} }),
    }
  );
  await page.goto('/');
  await page.getByLabel('題目來源').selectOption('review:starred');
  await page.getByLabel('隨機出題順序').uncheck();
  await page.getByRole('button', { name: /開始測驗/ }).click();
  await expect(page.locator('.question-card')).toBeVisible();
  await expect(page.locator('#main-content > .review-notice:not(.review-notice--end)')).toHaveText(/這一場先出主題庫/);
  await page.waitForTimeout(300);
  const ends = await page.evaluate(() => (window as unknown as { __ends: string[] }).__ends);
  expect(ends, '練習池載不到的說明排到首頁的最後面').toEqual([]);
});
