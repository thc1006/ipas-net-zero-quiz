import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * 小視窗上對話框比視窗高時，上緣與按鈕會跑到畫面外，遮罩又不能捲，只剩按旁邊的遮罩一條路。
 * jsdom 不排版，字級又是 CSS 變數，只有真瀏覽器量得到。首次造訪對話框是首頁第一個畫面，三個引擎都量。
 */

const SIZES: [number, number][] = [
  [320, 568],
  [360, 640],
  [375, 667],
  [390, 664],
  [412, 839],
  [844, 390],
  [839, 412],
  [740, 360],
  [667, 375],
  [568, 320],
];
const FONT_SIZES = ['normal', 'large', 'xlarge'];

/** 每個尺寸、每個字級量一次，回傳哪裡超出視窗；同一頁換尺寸與字級，不重新載入 */
async function offscreenParts(page: Page, dialog: string): Promise<string[]> {
  const bad: string[] = [];
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    for (const fontSize of FONT_SIZES) {
      // useAccessibility 的字級就是寫這個屬性
      await page.evaluate((size) => document.documentElement.setAttribute('data-font-size', size), fontSize);
      const parts = await page.evaluate((selector) => {
        const box = document.querySelector(selector)!;
        const rect = (el: Element) => el.getBoundingClientRect();
        return [
          ['對話框', rect(box)],
          ['標題', rect(box.querySelector('h2')!)],
          ...[...box.querySelectorAll('button')].map((b) => [b.textContent, rect(b)] as const),
        ].map(([name, r]) => {
          const { top, bottom, left, right } = r as DOMRect;
          return { name, top, bottom, left, right };
        });
      }, dialog);
      for (const { name, top, bottom, left, right } of parts) {
        if (top < 0 || bottom > height || left < 0 || right > width) {
          bad.push(`${width}x${height} ${fontSize} ${name}：上 ${top} 下 ${bottom} 左 ${left} 右 ${right}`);
        }
      }
    }
  }
  return bad;
}

test('首次造訪對話框：每個尺寸、每個字級，標題與按鈕都在畫面內', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('dialog', { name: '啟用加強練習池' })).toBeVisible();

  expect(await offscreenParts(page, '.optin-dialog')).toEqual([]);
});

test('首次造訪對話框：內文在對話框裡捲得到底，按鈕不跟著捲走', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('dialog', { name: '啟用加強練習池' })).toBeVisible();
  const body = page.locator('.optin-body');
  let scrollable = 0;

  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    for (const fontSize of FONT_SIZES) {
      await page.evaluate((size) => document.documentElement.setAttribute('data-font-size', size), fontSize);
      const m = await body.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
        const box = el.getBoundingClientRect();
        const last = el.lastElementChild!.getBoundingClientRect();
        const accept = [...document.querySelectorAll('.optin-actions button')].at(-1)!.getBoundingClientRect();
        const result = {
          overflow: el.scrollHeight > el.clientHeight,
          scrollTop: el.scrollTop,
          clientHeight: el.clientHeight,
          lastBottom: last.bottom,
          bodyBottom: box.bottom,
          acceptTop: accept.top,
        };
        el.scrollTop = 0;
        return result;
      });
      const where = `${width}x${height} ${fontSize}`;
      // 內文太矮就讀不了：至少留三行（行高約 1.6，最大字級 18px 約 86px）
      expect(m.clientHeight, `${where} 內文區高度`).toBeGreaterThanOrEqual(86);
      expect(m.lastBottom, `${where} 捲到底後內文的最後一段在捲動區內`).toBeLessThanOrEqual(m.bodyBottom + 1);
      expect(m.acceptTop, `${where} 按鈕在捲動區下面`).toBeGreaterThanOrEqual(m.bodyBottom);
      if (m.overflow) {
        expect(m.scrollTop, `${where} 真的捲得動`).toBeGreaterThan(0);
        scrollable++;
      }
    }
  }
  // 反空轉：這些尺寸裡真的有要捲的情況，上面的捲動斷言不是全部跳過
  expect(scrollable).toBeGreaterThan(0);
});

test('首次造訪對話框：開啟時焦點在第一顆按鈕，鍵盤捲得動內文，Tab 不會離開對話框', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  const decline = page.getByRole('button', { name: '暫不啟用' });
  const accept = page.getByRole('button', { name: /我已了解/ });
  const body = page.locator('.optin-body');
  await expect(decline).toBeFocused();

  // 手機直放按鈕各佔一列、一樣寬：擠在同一列時「暫不啟用」會斷成兩行
  const [first, second] = [await decline.boundingBox(), await accept.boundingBox()];
  expect(first!.y + first!.height).toBeLessThanOrEqual(second!.y);
  expect(first!.width).toBe(second!.width);

  await page.keyboard.press('Shift+Tab');
  await expect(body).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

  await page.keyboard.press('Shift+Tab'); // 繞到最後一顆
  await expect(accept).toBeFocused();
  await page.keyboard.press('Tab'); // 繞回內文
  await expect(body).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(decline).toBeFocused();
});

test('首次造訪對話框：滾輪捲得動內文', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');
  const body = page.locator('.optin-body');
  await body.hover();

  await page.mouse.wheel(0, 200);

  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

// 1280x1024、1366x768、1920x1080 放大 400% 與 1366x768 放大 300% 的 CSS 視窗
test('放大到 400%：內文至少三行，滾輪捲對話框，標題與按鈕都到得了', async ({ page }) => {
  await page.goto('/');
  const dialog = page.locator('.optin-dialog');
  await expect(dialog).toBeVisible();

  for (const [width, height] of [[320, 256], [341, 192], [480, 270], [455, 256]]) {
    await page.setViewportSize({ width, height });
    for (const fontSize of FONT_SIZES) {
      await page.evaluate((size) => document.documentElement.setAttribute('data-font-size', size), fontSize);
      const m = await dialog.evaluate((el) => {
        el.scrollTop = 0;
        const body = el.querySelector('.optin-body') as HTMLElement;
        const box = el.getBoundingClientRect();
        const title = el.querySelector('h2')!.getBoundingClientRect();
        return {
          bodyHeight: body.clientHeight,
          threeLines: 3 * parseFloat(getComputedStyle(body.querySelector('p')!).lineHeight),
          dialogInView: box.top >= 0 && box.bottom <= innerHeight,
          titleInView: title.top >= 0 && title.bottom <= innerHeight,
        };
      });
      const where = `${width}x${height} ${fontSize} ${JSON.stringify(m)}`;
      expect(m.bodyHeight, where).toBeGreaterThanOrEqual(Math.floor(m.threeLines));
      expect(m.dialogInView, where).toBe(true);
      expect(m.titleInView, where).toBe(true);

      // 標題不在內文的捲動區裡，滾輪在這裡捲的是對話框。scrollIntoView 連 overflow: hidden 都捲得動，驗不到
      // 剛換字級時版面還在變，滑鼠可能落在內文的捲動區，滾輪先捲內文；所以重複滾到按鈕進來。overflow: hidden 時永遠捲不到
      await expect(async () => {
        await dialog.locator('h2').hover();
        await page.mouse.wheel(0, 2000);
        for (const button of await dialog.locator('button').all()) {
          await expect(button, where).toBeInViewport({ ratio: 1, timeout: 500 });
        }
      }).toPass({ timeout: 10_000 });
    }
  }
});

test('放大到 400%：開啟時焦點在第一顆按鈕，Tab 到第二顆，兩顆都捲得進視窗', async ({ page }) => {
  await page.setViewportSize({ width: 341, height: 192 });
  await page.goto('/');
  const decline = page.getByRole('button', { name: '暫不啟用' });
  const accept = page.getByRole('button', { name: /我已了解/ });

  await expect(decline).toBeFocused();
  await expect(decline).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Tab');
  await expect(accept).toBeFocused();
  await expect(accept).toBeInViewport({ ratio: 1 });
});

test('首次造訪對話框：點對話框空白處再按 Tab 或 Shift+Tab，焦點不會離開對話框', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '暫不啟用' })).toBeFocused();
  const box = (await page.locator('.optin-dialog').boundingBox())!;
  const inDialog = () => page.evaluate(() => !!document.activeElement?.closest('.optin-dialog button, .optin-body'));

  for (const key of ['Shift+Tab', 'Tab']) {
    await page.mouse.click(box.x + 40, box.y + 8);
    await page.keyboard.press(key);
    expect(await inDialog(), `點空白處後按 ${key}`).toBe(true);
    await expect(page.getByRole('dialog')).toHaveCount(1);
  }
});

test('首次造訪對話框：焦點掉到 body 時按 Tab 或 Shift+Tab，焦點接回對話框', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await page.goto('/');
  const inDialog = () => page.evaluate(() => !!document.activeElement?.closest('.optin-dialog button, .optin-body'));
  const dropFocus = (locator: Locator) =>
    locator.evaluate((el) => {
      (el as HTMLElement).focus();
      (el as HTMLElement).blur();
    });

  await dropFocus(page.getByRole('button', { name: /我已了解/ })); // 從這裡往後是對話框外面
  await page.keyboard.press('Tab');
  expect(await inDialog(), '從最後一顆按鈕掉焦點後按 Tab').toBe(true);

  await dropFocus(page.locator('.optin-body')); // 從這裡往前是對話框外面
  await page.keyboard.press('Shift+Tab');
  expect(await inDialog(), '從內文區掉焦點後按 Shift+Tab').toBe(true);
});

test('結束測驗對話框：每個尺寸、每個字級都在畫面內', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('practice-pool-disclosure-seen', '1');
  });
  await page.goto('/');
  await page.getByRole('button', { name: /開始測驗/ }).click();
  await page.getByRole('button', { name: /結束並返回首頁/ }).click();
  await expect(page.getByRole('dialog', { name: '結束當前測驗？' })).toBeVisible();

  expect(await offscreenParts(page, '.quiz-abort-dialog')).toEqual([]);
});

test('清除作答統計對話框：每個尺寸、每個字級都在畫面內', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('practice-pool-disclosure-seen', '1');
  });
  await page.goto('/');
  await page.getByRole('button', { name: '開啟設定' }).click();
  await page.getByRole('button', { name: '清除作答統計' }).click();
  await expect(page.getByRole('dialog', { name: '清除作答統計？' })).toBeVisible();

  expect(await offscreenParts(page, '.settings-confirm-dialog')).toEqual([]);
});
