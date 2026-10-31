import { test, expect, type Page } from '@playwright/test';

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
