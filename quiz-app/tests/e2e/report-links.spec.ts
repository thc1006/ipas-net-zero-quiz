import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * 回報問題（GitHub issue）與討論區（GitHub Discussions）分成兩個入口：頁首、設定頁的「關於」與頁尾各有一組。
 * 頁首在寬螢幕顯示字、640px 以下只留圖示；字級與各引擎的字寬不同，jsdom 又不排版，只有真瀏覽器量得到，
 * 所以這支 spec 也跑在 Firefox 與 WebKit（playwright.config.ts 的 firefox-smoke／webkit-smoke）。
 */

// PR #37 加了首次自動彈 PracticeOptInDialog；先設定 seen flag，畫面才不會被 dialog 擋住。
// fontSize 走無障礙設定真正讀的 localStorage（useAccessibility 的 ipas-quiz-a11y）。
async function gotoHome(page: Page, fontSize: 'normal' | 'xlarge' = 'normal'): Promise<void> {
  await page.addInitScript((size) => {
    window.localStorage.setItem('practice-pool-disclosure-seen', '1');
    window.localStorage.setItem('ipas-quiz-a11y', JSON.stringify({ fontSize: size }));
  }, fontSize);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-font-size', fontSize);
  // 圖示是 Material Icons 字型的連字：字型沒載入時畫的是「bug_report」這串字，量的就不是平常的版面。
  // document.fonts.check 在沒有任何 Material Icons 字型宣告時也回 true，所以直接找那個 FontFace 看狀態
  const icons = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === 'Material Icons').map((f) => f.status);
  });
  expect(icons, 'Material Icons 字型沒有載入').toContain('loaded');
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** 連結裡的字排成幾行（擠成兩行以上的「回報 / 問題」也算壞掉） */
const textLines = (link: Locator) =>
  link.evaluate((el) => {
    const lines = new Set<number>();
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE && !(node as Element).matches?.('.header-link-text')) continue;
      if (!node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) if (rect.width > 0) lines.add(Math.round(rect.top));
    }
    return lines.size;
  });

test.describe('回報問題與討論區', () => {
  for (const fontSize of ['normal', 'xlarge'] as const) {
    for (const width of [320, 360, 390, 481, 640, 641, 768, 1280]) {
      test(`頁首 ${width}px、字級 ${fontSize}：兩個入口完整落在畫面內、不重疊，整頁不會橫向捲動`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await gotoHome(page, fontSize);
        const header = page.getByRole('banner');
        const report = header.getByRole('link', { name: '回報問題' });
        const discuss = header.getByRole('link', { name: '討論區' });
        await expect(report).toBeVisible();
        await expect(discuss).toBeVisible();

        // 頁首的每一個東西：回首頁、深色模式、設定、回報問題、討論區，由左到右排在同一列
        const items = [
          header.getByRole('button', { name: '回首頁' }),
          header.getByRole('button', { name: /切換(深色|淺色)模式/ }),
          header.getByRole('button', { name: '開啟設定' }),
          report,
          discuss,
        ];
        const boxes = await Promise.all(items.map(async (item) => (await item.boundingBox())!));
        for (const [i, box] of boxes.entries()) {
          expect(box.x, `第 ${i + 1} 個超出左邊`).toBeGreaterThanOrEqual(-0.5);
          expect(box.x + box.width, `第 ${i + 1} 個超出右邊`).toBeLessThanOrEqual(width + 0.5);
          if (i > 0) expect(box.x, `第 ${i + 1} 個與前一個重疊`).toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width - 0.5);
        }
        // 操作按鈕在同一列（沒有被擠到第二行），點擊區至少 40px（Firefox 量到 39.999999，留半個像素）
        for (const box of boxes.slice(1)) {
          expect(Math.abs(box.y - boxes[1].y), '頁首的按鈕換行了').toBeLessThanOrEqual(0.5);
          expect(Math.min(box.width, box.height), '點擊區太小').toBeGreaterThanOrEqual(39.5);
        }
        // 字在連結的框裡，沒有被擠出來
        for (const link of [report, discuss]) {
          const spill = await link.evaluate((el) => el.scrollWidth - el.clientWidth);
          expect(spill, '連結裡的字超出框').toBeLessThanOrEqual(0);
        }
        // 640px 以下只留圖示，跟深色模式、設定一樣大；比較寬時圖示旁顯示字，字排在一行。
        // 窄版的判斷交給瀏覽器：WebKit 拿扣掉捲軸的寬度比 media query，視窗 641px 時已經是窄版（捲軸 8px）
        const narrow = await page.evaluate(() => matchMedia('(max-width: 640px)').matches);
        if (width <= 640) expect(narrow, '640px 以下應該是窄版').toBe(true);
        if (width >= 768) expect(narrow, '768px 以上不該是窄版').toBe(false);
        const settings = boxes[2];
        for (const [i, link] of [report, discuss].entries()) {
          const text = link.locator('.header-link-text');
          if (!narrow) {
            await expect(text).toBeVisible();
            expect(await textLines(link), '頁首連結的字斷成兩行').toBe(1);
          } else {
            await expect(text).toBeHidden();
            const box = boxes[3 + i];
            expect(Math.abs(box.width - settings.width), '窄螢幕的連結與其他按鈕不一樣寬').toBeLessThanOrEqual(0.5);
            expect(Math.abs(box.height - settings.height), '窄螢幕的連結與其他按鈕不一樣高').toBeLessThanOrEqual(0.5);
          }
        }
        expect(await overflow(page), '頁首把頁面撐寬了').toBe(0);
      });
    }
  }

  for (const width of [320, 360, 390]) {
    // 圖示是字型的連字，字型被擋時畫成「bug_report」「add_circle_outline」這樣的字。要看的是整頁：首頁提示卡的
    // 「了解並啟用」按鈕也有圖示，CI 的 Chromium 與 WebKit 都是它把頁面撐寬（1px、13px），頁首的按鈕沒有超出
    test(`字型被擋時 ${width}px：圖示畫成字也不會把頁面撐寬`, async ({ page }) => {
      await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
      await page.setViewportSize({ width, height: 800 });
      await page.addInitScript(() => window.localStorage.setItem('practice-pool-disclosure-seen', '1'));
      await page.goto('/');
      const header = page.getByRole('banner');
      await expect(header.getByRole('link', { name: '討論區' })).toBeVisible();
      await expect(page.getByRole('button', { name: /了解並啟用/ })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      // 確認真的被擋了：沒有任何已載入的 Material Icons
      const loaded = await page.evaluate(() =>
        [...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'Material Icons' && f.status === 'loaded')
      );
      expect(loaded, '字型沒有被擋下，這條測試在空轉').toBe(false);
      const right = await page.evaluate(() =>
        Math.max(...[...document.querySelectorAll('.header-actions > *')].map((el) => el.getBoundingClientRect().right))
      );
      expect(right, '頁首的按鈕超出右邊').toBeLessThanOrEqual(width + 0.5);
      expect(await overflow(page), '圖示畫成字，把頁面撐寬了').toBe(0);
    });
  }

  test('鍵盤：設定之後 Tab 依序到回報問題、討論區，焦點框看得到', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await gotoHome(page);
    await page.getByRole('button', { name: '開啟設定' }).focus();
    for (const name of ['回報問題', '討論區']) {
      await page.keyboard.press('Tab');
      const link = page.getByRole('banner').getByRole('link', { name });
      await expect(link).toBeFocused();
      const outline = await link.evaluate((el) => {
        const style = getComputedStyle(el);
        return [style.outlineStyle, parseFloat(style.outlineWidth)] as const;
      });
      expect(outline[0], `${name} 的焦點框`).not.toBe('none');
      expect(outline[1], `${name} 的焦點框`).toBeGreaterThanOrEqual(2);
    }
  });

  for (const fontSize of ['normal', 'xlarge'] as const) {
    test(`設定頁「關於」與頁尾 320px、字級 ${fontSize}：三個連結都在畫面內，整頁不會橫向捲動`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await gotoHome(page, fontSize);
      const footer = page.getByRole('contentinfo');
      for (const name of ['GitHub 專案連結', '回報問題', '討論區']) {
        const box = (await footer.getByRole('link', { name }).boundingBox())!;
        expect(box.x + box.width, `頁尾的 ${name} 超出右邊`).toBeLessThanOrEqual(320.5);
      }
      expect(await overflow(page), '頁尾把頁面撐寬了').toBe(0);

      await page.getByRole('button', { name: '開啟設定' }).click();
      const about = page.locator('.about-section');
      await about.scrollIntoViewIfNeeded();
      const card = (await about.boundingBox())!;
      expect(card.x + card.width, '關於區塊超出右邊').toBeLessThanOrEqual(320.5);
      for (const name of ['GitHub 原始碼', '回報問題', '討論區']) {
        const link = about.getByRole('link', { name });
        const box = (await link.boundingBox())!;
        expect(box.x, `關於的 ${name} 超出區塊左邊`).toBeGreaterThanOrEqual(card.x - 0.5);
        expect(box.x + box.width, `關於的 ${name} 超出區塊右邊`).toBeLessThanOrEqual(card.x + card.width + 0.5);
        expect(await textLines(link), `關於的 ${name} 斷成兩行`).toBe(1);
      }
      // 圖示固定一個字寬（global.css）。overflow: hidden 讓 flex 子項可以縮得比內容窄，設定頁一行行的說明旁邊的圖示
      // 會被擠扁，flex-shrink: 0 擋住
      const squeezed = await page.evaluate(() =>
        [...document.querySelectorAll('.material-icons')]
          .filter((el) => el.getClientRects().length > 0)
          .map((el) => [el.textContent, el.getBoundingClientRect().width, parseFloat(getComputedStyle(el).fontSize)] as const)
          .filter(([, w, em]) => Math.abs(w - em) > 0.5)
      );
      expect(squeezed, '設定頁的圖示不是一個字寬').toEqual([]);
      expect(await overflow(page), '設定頁把頁面撐寬了').toBe(0);
    });
  }
});
