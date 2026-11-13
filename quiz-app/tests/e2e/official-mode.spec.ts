import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { SLACK, settle } from './layout';

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
        // 也不能多出它前面那一段 flex 的 gap：「題目來源」那一格與「考科範圍」一樣高（說明本身高 0 也照樣多 4px）。
        // 兩格在同一次 evaluate 裡量：選單的高度跟著字型走，Noto Sans TC 載入前後 Chromium 差 7px、WebKit 差 0.5 到 3.5px。
        // Chromium 通常到 load 事件之後才下載這些字型（WebKit 偶爾也是），goto 回來時還沒載完；分兩次量的話，
        // 字型剛好在兩次中間載好，兩格就差這麼多
        const items = await Promise.all(
          ['考科範圍', '題目來源'].map((label) =>
            page
              .locator('.config-item')
              .filter({ has: page.getByLabel(label) })
              .elementHandle()
          )
        );
        const [subjectItem, sourceItem] = await page.evaluate(
          (els) => els.map((el) => el!.getBoundingClientRect().height),
          items
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

    // 題數不夠的那一句自成一行、用警示色，不會黏在上一句後面看不出來。
    // 兩句在同一次 evaluate 裡量：題數的輸入框在視窗外，Firefox 打完字要到下一個 frame 才把游標捲進視窗（捲 98px），
    // 分兩次 boundingBox() 量的話，這一捲可能落在兩次中間，上一句量到的是捲動前的位置
    const [firstBottom, ownTop] = await notice.evaluate(
      (own, first) => [first!.getBoundingClientRect().bottom, own.getBoundingClientRect().top],
      await page.getByText(/^可出 \d+ 題官方公告試題/).elementHandle()
    );
    expect(ownTop, '題數不夠的提醒應該另起一行').toBeGreaterThanOrEqual(firstBottom - 0.5);
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

/** 控制項的上緣、頁首下緣、視窗高度與捲動位置，一次量 */
const spot = (control: Locator) =>
  control.evaluate((el) => ({
    top: el.getBoundingClientRect().top,
    bottom: el.getBoundingClientRect().bottom,
    header: document.querySelector('.app-header')!.getBoundingClientRect().bottom,
    viewport: document.documentElement.clientHeight,
    scrollY: window.scrollY,
  }));

/** 把控制項捲到頁首下面（top）或視窗底邊（bottom） */
const place = (control: Locator, where: 'top' | 'bottom') =>
  control.evaluate((el, where) => {
    const box = el.getBoundingClientRect();
    const header = document.querySelector('.app-header')!.getBoundingClientRect().bottom;
    window.scrollBy(0, where === 'top' ? box.top - (header + 2) : box.bottom - (document.documentElement.clientHeight - 2));
  }, where);

/** 等版面停下來再量（layout.ts） */
const nextFrames = settle;

// 使用者換了首頁的控制項，上面的說明卡、題數說明跟著長高或變矮（只出官方題目時說明卡換字、拿掉開關與抽題分布，
// 長高 29px 或變矮 64px）。正在操作的控制項要留在原來的位置：之前 WebKit 1280x720 選全部官方題目時題目來源從 66 移到 10
// （頁首底下），Pixel 7 字級特大時說明卡長高 29px，題目來源被推到視窗底邊下面 19px。操作的當下就捲回去，等畫完再量
test.describe('首頁：換了控制項之後上面的內容長高或變矮，正在操作的控制項不移動', () => {
  for (const { name, viewport, fontSize, pool, where } of [
    { name: '1280x720 加強練習池啟用 頁首下面', viewport: { width: 1280, height: 720 }, fontSize: undefined, pool: true, where: 'top' },
    { name: '640x360 頁首下面', viewport: { width: 640, height: 360 }, fontSize: undefined, pool: false, where: 'top' },
    { name: '412x839 字級特大 加強練習池啟用 視窗底邊', viewport: { width: 412, height: 839 }, fontSize: 'xlarge', pool: true, where: 'bottom' },
    { name: '412x839 字級特大 頁首下面', viewport: { width: 412, height: 839 }, fontSize: 'xlarge', pool: false, where: 'top' },
  ] as const) {
    test(`題目來源 ${name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((pool) => {
        window.localStorage.setItem('practice-pool-ai-opt-in', '1');
        window.localStorage.setItem('practice-pool-enabled', pool ? '1' : '0');
      }, pool);
      await gotoHome(page, fontSize);
      const source = page.getByLabel('題目來源');
      const card = page.getByTestId('practice-pool-tip');
      let changed = 0;
      for (const value of ['official', 'all', 'review:starred', 'all']) {
        await source.focus();
        await place(source, where);
        await nextFrames(page);
        const before = await spot(source);
        // 說明卡變矮時頁面要往上捲回去：捲動位置要夠（換回全部題目是長高，往下捲一定捲得到）
        if (value !== 'all') expect(before.scrollY, '前提：捲得回去').toBeGreaterThan(80);
        const cardBefore = (await card.boundingBox())!.height;
        await source.selectOption(value);
        await nextFrames(page);
        const after = await spot(source);
        if (Math.abs((await card.boundingBox())!.height - cardBefore) > 1) changed++;
        expect(Math.abs(after.top - before.top), `換成 ${value}：題目來源移動了 ${JSON.stringify({ before, after })}`).toBeLessThanOrEqual(SLACK);
      }
      // 反空轉：上面的說明卡真的換過高度
      expect(changed).toBeGreaterThan(0);
    });
  }

  // 一路來回換（全部官方題目、全部題目各 6 次）：說明卡每次差的高度有小數，WebKit 的捲動位置只留整數、小數捨去。
  // 誤差不能一次一次累積，題目來源一直在原來的位置（1px 以內）、不超出視窗底邊
  test('題目來源 412x839 字級特大 視窗底邊：來回換 12 次，題目來源一直留在原來的位置', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 839 });
    await page.addInitScript(() => {
      window.localStorage.setItem('practice-pool-ai-opt-in', '1');
      window.localStorage.setItem('practice-pool-enabled', '1');
    });
    await gotoHome(page, 'xlarge');
    const source = page.getByLabel('題目來源');
    await nextFrames(page);
    await source.focus();
    await place(source, 'bottom');
    await nextFrames(page);
    const start = await spot(source);
    for (let i = 0; i < 12; i++) {
      await source.selectOption(i % 2 ? 'all' : 'official');
      await nextFrames(page);
      const now = await spot(source);
      expect(Math.abs(now.top - start.top), `第 ${i + 1} 次之後題目來源移動了 ${JSON.stringify({ start, now })}`).toBeLessThanOrEqual(SLACK);
      expect(now.bottom, `第 ${i + 1} 次之後超出視窗底邊 ${JSON.stringify(now)}`).toBeLessThanOrEqual(now.viewport + SLACK);
    }
  });

  test('題數 412x839：題數超過可出的題數，上面的題數說明多一行，題數不移動', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 839 });
    await gotoHome(page);
    const options = await page.getByLabel('題目來源').evaluate((el: HTMLSelectElement) => [...el.options].map((o) => o.value));
    await page.getByLabel('題目來源').selectOption(options.find((v) => v.startsWith('sample:'))!);
    const count = page.locator('#count');
    const hint = page.locator('#source-hint');
    // 預設的題數已經超過可出的題數，先打一個放得下的
    for (const value of ['5', '50', '5', '60']) {
      await count.focus();
      await place(count, 'top');
      await nextFrames(page);
      const before = await spot(count);
      const hintBefore = (await hint.boundingBox())!.height;
      await count.fill(value);
      await nextFrames(page);
      const after = await spot(count);
      expect(Math.abs((await hint.boundingBox())!.height - hintBefore), '前提：題數說明換了高度').toBeGreaterThan(1);
      expect(Math.abs(after.top - before.top), `打 ${value}：題數移動了 ${JSON.stringify({ before, after })}`).toBeLessThanOrEqual(SLACK);
    }
  });

  for (const how of ['click', 'dialog'] as const) {
    test(`加強練習池的開關 640x360 在視窗底邊${how === 'dialog' ? '，第一次啟用時按對話框的同意' : ''}：說明卡換字、加上或拿掉抽題分布，開關不移動`, async ({ page }) => {
      await page.setViewportSize({ width: 640, height: 360 });
      if (how === 'click') await page.addInitScript(() => window.localStorage.setItem('practice-pool-ai-opt-in', '1'));
      await gotoHome(page);
      const cta = page.locator('.practice-pool-tip__cta');
      for (const label of how === 'click' ? [/^add_circle_outline啟用/, /^remove_circle_outline停用/] : [/了解並啟用/]) {
        await expect(cta).toHaveText(label);
        await cta.focus();
        await place(cta, 'bottom');
        await nextFrames(page);
        const before = await spot(cta);
        expect(before.bottom, '前提：開關在視窗底邊').toBeGreaterThan(before.viewport - 3);
        const cardBefore = (await page.getByTestId('practice-pool-tip').boundingBox())!.height;
        if (how === 'click') await cta.click();
        else {
          await page.keyboard.press('Enter');
          await page.getByRole('button', { name: /我已了解/ }).click();
        }
        await nextFrames(page);
        const after = await spot(cta);
        const card = (await page.getByTestId('practice-pool-tip').boundingBox())!.height;
        expect(Math.abs(card - cardBefore), '前提：說明卡換了高度').toBeGreaterThan(1);
        expect(Math.abs(after.top - before.top), `開關移動了 ${JSON.stringify({ before, after })}`).toBeLessThanOrEqual(SLACK);
      }
    });
  }
});
