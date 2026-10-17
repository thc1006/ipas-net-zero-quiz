import { test, expect, type Page } from '@playwright/test';

/**
 * #128 只出官方題目：「題目來源」選單放在既有的測驗設定裡（不另加按鈕）。
 * 規格要求行動版與鍵盤都能用；jsdom 不排版、也沒有真的焦點順序，只有真瀏覽器驗得到。
 */

// PR #37 加了首次自動彈 PracticeOptInDialog；先設定 seen flag，畫面才不會被 dialog 擋住。
// fontSize 走無障礙設定真正讀的 localStorage（useAccessibility 的 ipas-quiz-a11y）。
async function gotoHome(page: Page, fontSize?: 'normal' | 'xlarge'): Promise<void> {
  await page.addInitScript((size) => {
    window.localStorage.setItem('practice-pool-disclosure-seen', '1');
    if (size) window.localStorage.setItem('ipas-quiz-a11y', JSON.stringify({ fontSize: size }));
  }, fontSize);
  await page.goto('/');
  if (fontSize) await expect(page.locator('html')).toHaveAttribute('data-font-size', fontSize);
}

test.describe('只出官方題目', () => {
  test('鍵盤：Tab 到題目來源、方向鍵選全部官方題目、Enter 開始，題卡帶官方標籤', async ({ page }) => {
    await gotoHome(page);
    const source = page.getByLabel('題目來源');
    let reached = false;
    for (let i = 0; i < 30 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await source.evaluate((el) => el === document.activeElement);
    }
    expect(reached, 'Tab 序列應在 30 次內到達題目來源選單').toBe(true);

    await page.keyboard.press('ArrowDown'); // 全部題目 → 全部官方題目
    await expect(source).toHaveValue('official');
    await expect(
      page.getByText(/^可出 \d+ 題官方題目（公告試題與參考樣題），不會混入其他來源的題目。$/)
    ).toBeVisible();

    // 隨機出題順序也要能用鍵盤切換
    const shuffle = page.getByLabel('隨機出題順序');
    await shuffle.focus();
    await page.keyboard.press('Space');
    await expect(shuffle).not.toBeChecked();

    await page.getByRole('button', { name: /開始測驗/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.question-card')).toBeVisible();
    // 不隨機：第一題是原卷順序最早的那一份（114 年版參考樣題）。標籤前面有 material-icons 圖示的文字
    // （account_balance），不能錨定開頭
    await expect(page.locator('.question-card').getByText(/官方參考樣題（114 年版）/)).toBeVisible();
  });

  // 選單寬度跟著最長的選項與字級走：最大字級最容易把頁面撐寬
  for (const fontSize of ['normal', 'xlarge'] as const) {
    for (const width of [320, 360, 390]) {
      test(`手機 ${width}px、字級 ${fontSize}：題目來源選單完整落在設定區內，每個選項都完整顯示，整頁不會橫向捲動`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await gotoHome(page, fontSize);
        const source = page.getByLabel('題目來源');
        await expect(source).toBeVisible();
        // 只看視窗不夠：沒有 min-width: 0 時，390px 一般字級的欄寬被考科範圍撐到 369 到 371px，
        // 選單凸出設定區 11 到 13px，卻還在視窗內（Chromium、Firefox）
        const box = (await source.boundingBox())!;
        const grid = (await page.locator('.config-grid').boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(grid.x - 0.5);
        expect(box.x + box.width, '選單凸出測驗設定區').toBeLessThanOrEqual(grid.x + grid.width + 0.5);
        expect(grid.x + grid.width).toBeLessThanOrEqual(width + 0.5);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow, '測驗設定的選單把頁面撐寬了').toBe(0);
        // 全部題目時說明是空的：它一直在畫面上（live region），但不佔高度
        const empty = await page.locator('#source-hint').evaluate((el) => [el.textContent, el.getBoundingClientRect().height]);
        expect(empty, '空的題目來源說明不該佔高度').toEqual(['', 0]);
        // 也不能多出它前面那一段 flex 的 gap：「題目來源」那一格與「考科範圍」一樣高（說明本身高 0 也照樣多 4px）
        const [subjectItem, sourceItem] = await Promise.all(
          ['考科範圍', '題目來源'].map((label) =>
            page
              .locator('.config-item')
              .filter({ has: page.getByLabel(label) })
              .evaluate((el) => el.getBoundingClientRect().height)
          )
        );
        expect(Math.abs(sourceItem - subjectItem), '空的題目來源說明多出了一段間距').toBeLessThanOrEqual(0.5);

        // 選單跟著欄寬縮（min-width: 0），選中的選項太長就被截掉一段，上面的斷言照樣通過：原本的
        // 「全部官方題目（公告試題與參考樣題）」在 320px 與最大字級、「115 年第二次官方公告試題」在 320px 的最大字級
        // 都被截掉。完整顯示一個選項要多寬交給瀏覽器量：複製一個只有這個選項的選單、寬度設成 max-content，
        // 量出來的就是選項文字加上下拉箭頭、padding 與框線
        const cut = await source.evaluate((select: HTMLSelectElement) => {
          const width = select.getBoundingClientRect().width;
          return [...select.options].flatMap((option) => {
            const probe = select.cloneNode(false) as HTMLSelectElement;
            probe.removeAttribute('id');
            probe.appendChild(option.cloneNode(true));
            Object.assign(probe.style, {
              position: 'absolute',
              visibility: 'hidden',
              width: 'max-content',
              minWidth: '0',
              maxWidth: 'none',
            });
            select.parentElement!.appendChild(probe);
            const need = probe.getBoundingClientRect().width;
            probe.remove();
            return need > width + 0.5
              ? [`${option.text}：要 ${need.toFixed(1)}px，選單只有 ${width.toFixed(1)}px`]
              : [];
          });
        });
        expect(cut, '題目來源的選項選中時會被截掉一段').toEqual([]);

        // 選了全部官方題目之後，說明出現也不能把頁面撐寬
        await source.selectOption('official');
        await expect(page.getByText(/^可出 \d+ 題官方題目/)).toBeVisible();
        const after = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(after, '說明文字出現後把頁面撐寬了').toBe(0);
      });
    }
  }

  test('考科與場次可以組合；題數多於官方題時明確告知，實際就出那麼多題', async ({ page }) => {
    await gotoHome(page);
    await page.getByLabel('考科範圍').selectOption('考科2');
    const source = page.getByLabel('題目來源');
    const sessions = await source
      .locator('option')
      .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter((v) => v.startsWith('exam:')));
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    await source.selectOption(sessions[0]);
    await page.getByLabel('題數').fill('100');

    const notice = page.getByText(/^題數設定是 100 題，但只有 \d+ 題官方公告試題，本次會出 \d+ 題。$/);
    await expect(notice).toBeVisible();
    const n = Number((await notice.textContent())!.match(/只有 (\d+) 題/)![1]);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(100);

    // 題數不夠的那一句自成一行、用警示色，不會黏在上一句後面看不出來
    const first = (await page.getByText(/^可出 \d+ 題官方公告試題/).boundingBox())!;
    const own = (await notice.boundingBox())!;
    expect(own.y, '題數不夠的提醒應該另起一行').toBeGreaterThanOrEqual(first.y + first.height - 0.5);
    const [color, warning, weight] = await notice.evaluate((el) => {
      const probe = document.body.appendChild(document.createElement('span'));
      probe.style.color = 'var(--color-warning-fg)';
      const want = getComputedStyle(probe).color;
      probe.remove();
      return [getComputedStyle(el).color, want, getComputedStyle(el).fontWeight];
    });
    expect(color, '題數不夠的提醒應該用警示色 --color-warning-fg').toBe(warning);
    expect(weight, '題數不夠的提醒應該加粗（500）').toBe('500');

    await page.getByRole('button', { name: /開始測驗/ }).click();
    await expect(page.locator('.question-card')).toBeVisible();
    await expect(page.locator('.progress-info > span').first()).toHaveText(`1 / ${n}`);
    await expect(page.getByText(/年第.+次官方公告試題/)).toBeVisible();
  });
});
