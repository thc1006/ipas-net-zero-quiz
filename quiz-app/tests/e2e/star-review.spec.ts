import { readFileSync } from 'node:fs';
import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * 星號與待複習錯題（Discussion #1）。jsdom 沒有排版、焦點順序、跨分頁的 storage 事件，也沒有真的下載，
 * 這些都要在真瀏覽器驗：題目來源選單的新選項放不放得下、按鈕的觸控大小、兩個分頁各加一顆星、
 * 重新整理之後續作、匯出檔在全新的瀏覽器環境匯入。
 */

const KEY = 'ipas-review-v1';

interface GistItem {
  index: number;
  stem: string;
  answer: string;
  options: { key: string; text: string }[];
}
const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf-8'));
const dataset = readJson('../../src/data/integrated_dataset.json') as {
  gist_items: GistItem[];
  our_unique_items: (GistItem & { item_id: string; official_exam?: { session: string; subject: string } })[];
};
const practicePool = readJson('../../src/data/practice_pool.json') as { items: { id: string }[] };
const bank = dataset.gist_items;
const idOf = (q: GistItem) => `gist-${q.index}`;
const [q1, q2, q3] = bank;
const everyId = [
  ...bank.map(idOf),
  ...dataset.our_unique_items.map((q) => q.item_id),
  ...practicePool.items.map((q) => q.id),
];

interface Seed {
  stars?: string[];
  wrong?: Record<string, { streak: number; last: number }>;
}

// fontSize 走無障礙設定真正讀的 localStorage。重新整理時 init script 會再跑一次，所以只在沒有資料時寫入
async function gotoHome(page: Page, seed?: Seed, fontSize?: 'normal' | 'large' | 'xlarge'): Promise<void> {
  const raw = seed && {
    v: 1,
    seeded: true,
    stars: Object.fromEntries((seed.stars ?? []).map((id) => [id, 1])),
    wrong: seed.wrong ?? {},
  };
  await page.addInitScript(
    ({ key, value, size }) => {
      window.localStorage.setItem('practice-pool-disclosure-seen', '1');
      if (value && !window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
      if (size) window.localStorage.setItem('ipas-quiz-a11y', JSON.stringify({ fontSize: size }));
    },
    { key: KEY, value: raw ? JSON.stringify(raw) : null, size: fontSize }
  );
  await page.goto('/');
  if (fontSize) await expect(page.locator('html')).toHaveAttribute('data-font-size', fontSize);
}

const source = (page: Page) => page.getByLabel('題目來源');
const star = (page: Page) => page.getByRole('button', { name: '加星號' });
const stem = (page: Page) => page.locator('.question-stem p');
const startButton = (page: Page) => page.getByRole('button', { name: /開始測驗/ });
const progress = (page: Page) => page.locator('.progress-info > span').first();
const optionLabel = (page: Page, value: string) =>
  source(page).locator(`option[value="${value}"]`).textContent();
const answer = (page: Page, q: GistItem, right: boolean) =>
  page
    .getByTestId(`option-${right ? q.answer : q.options.find((o) => o.key !== q.answer)!.key}`)
    .click();
const stored = (page: Page) =>
  page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? '{}'), KEY) as Promise<{
    stars: Record<string, number>;
    wrong: Record<string, { streak: number; last: number }>;
  }>;
const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/**
 * 版面上的 CSS 像素。boundingBox 量的是畫出來的位置：題卡進場動畫的 transform 還沒結束時，
 * Firefox 量到 43.99999（CSS 是 44px）
 */
const layoutSize = (locator: Locator) =>
  locator.evaluate((el: HTMLElement) => ({ width: el.offsetWidth, height: el.offsetHeight }));

/**
 * 哪些選項選中時放不下。完整顯示一個選項要多寬交給瀏覽器量：複製一個只有這個選項的選單、寬度設成 max-content，
 * 量出來的就是選項文字加上下拉箭頭、padding 與框線（見 official-mode.spec.ts）
 */
const cutOptions = (page: Page) =>
  source(page).evaluate((el: HTMLSelectElement) => {
    const available = el.getBoundingClientRect().width;
    return [...el.options].flatMap((option) => {
      const probe = el.cloneNode(false) as HTMLSelectElement;
      probe.removeAttribute('id');
      probe.appendChild(option.cloneNode(true));
      Object.assign(probe.style, {
        position: 'absolute',
        visibility: 'hidden',
        width: 'max-content',
        minWidth: '0',
        maxWidth: 'none',
      });
      el.parentElement!.appendChild(probe);
      const need = probe.getBoundingClientRect().width;
      probe.remove();
      return need > available + 0.5
        ? [`${option.text}：要 ${need.toFixed(1)}px，選單只有 ${available.toFixed(1)}px`]
        : [];
    });
  });

/** 星號的線條與它實際疊在上面的背景的對比。背景看按鈕本身，透明就往外找 */
const starContrast = (locator: Locator) =>
  locator.evaluate((button) => {
    const rgb = (color: string) => {
      const parts = color.match(/[\d.]+/g)!.map(Number);
      return { value: parts.slice(0, 3), alpha: parts[3] ?? 1 };
    };
    const luminance = ([r, g, b]: number[]) => {
      const f = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const icon = rgb(getComputedStyle(button.querySelector('path')!).stroke).value;
    let el: Element | null = button;
    let background = [255, 255, 255];
    while (el) {
      const bg = rgb(getComputedStyle(el).backgroundColor);
      if (bg.alpha === 1) {
        background = bg.value;
        break;
      }
      el = el.parentElement;
    }
    const [hi, lo] = [luminance(icon), luminance(background)].sort((a, b) => b - a);
    return (hi + 0.05) / (lo + 0.05);
  });

/** 選來源、不隨機（順序才固定）、開始 */
async function startDrill(page: Page, value: string, mode: 'practice' | 'exam' = 'practice') {
  await source(page).selectOption(value);
  await page.getByLabel('測驗模式').selectOption(mode);
  await page.getByLabel('隨機出題順序').uncheck();
  await startButton(page).click();
  await expect(page.locator('.question-card')).toBeVisible();
}

test.describe('星號與待複習錯題', () => {
  test('加星號、重新整理還在；題目來源題數更新；開始之後只出星號題', async ({ page }) => {
    const errors: Error[] = [];
    page.on('pageerror', (e) => errors.push(e));
    await gotoHome(page);
    expect(await optionLabel(page, 'review:starred')).toBe('星號題（0 題）');
    await page.getByLabel('隨機出題順序').uncheck();
    await startButton(page).click();
    const first = await stem(page).textContent();

    await expect(star(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(star(page).locator('path')).toHaveAttribute('fill', 'none');
    await star(page).click();
    await expect(star(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(star(page).locator('path')).toHaveAttribute('fill', 'currentColor');
    const hint = page.getByRole('status').filter({ hasText: '已加星號，首頁「題目來源」選「星號題」可以反覆練習。' });
    await expect(hint).toBeVisible();

    await page.reload();
    await expect(hint).toHaveCount(0);
    expect(await optionLabel(page, 'review:starred')).toBe('星號題（1 題）');
    await startDrill(page, 'review:starred');
    await expect(progress(page)).toHaveText('1 / 1');
    await expect(stem(page)).toHaveText(first!);
    await expect(star(page)).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
  });

  test('連續兩場答對才移出；答完才看得到進度；名單空了再測一次留在結果頁', async ({ page }) => {
    await gotoHome(page, { wrong: { [idOf(q1)]: { streak: 0, last: 1 } } });
    expect(await optionLabel(page, 'review:wrong')).toBe('待複習錯題（1 題）');

    await startDrill(page, 'review:wrong');
    await expect(page.getByText('再答對 1 次移出')).toHaveCount(0);
    await answer(page, q1, true);
    await expect(page.getByRole('button', { name: '移出待複習' })).toBeVisible();
    await expect(page.getByText('再答對 1 次移出')).toBeVisible();
    await page.getByRole('button', { name: /完成測驗/ }).click();
    expect((await stored(page)).wrong[idOf(q1)].streak).toBe(1);

    await page.getByRole('button', { name: /再測一次/ }).click();
    await expect(stem(page)).toBeVisible();
    await expect(page.getByText('這場結束會移出')).toHaveCount(0);
    await answer(page, q1, true);
    await expect(page.getByText('這場結束會移出')).toBeVisible();
    await page.getByRole('button', { name: /完成測驗/ }).click();
    expect((await stored(page)).wrong).toEqual({});
    await expect(page.getByText('這場有 1 題移出。')).toBeVisible();

    await page.getByRole('button', { name: /再測一次/ }).click();
    await expect(page.getByText('目前沒有待複習錯題可以再測一次，回首頁可以選其他題目來源。')).toBeVisible();
    await expect(page.locator('.question-card')).toHaveCount(0);

    await page.getByRole('button', { name: /返回首頁/ }).click();
    await source(page).selectOption('review:wrong');
    expect(await optionLabel(page, 'review:wrong')).toBe('待複習錯題（0 題）');
    await expect(page.getByText(/^還沒有待複習錯題/)).toBeVisible();
    await expect(startButton(page)).toBeDisabled();
  });

  test('答錯的題目進待複習；手動移出；星號不受影響', async ({ page }) => {
    await gotoHome(page, { stars: [idOf(q1)] });
    await startDrill(page, 'review:starred');
    await answer(page, q1, false);
    await page.getByRole('button', { name: /完成測驗/ }).click();
    expect((await stored(page)).wrong[idOf(q1)]).toMatchObject({ streak: 0 });
    await expect(page.getByText('這場有 1 題進待複習。')).toBeVisible();
    const hint = page.getByText('答錯的題目已進待複習，首頁「題目來源」選「待複習錯題」可以練。');
    await expect(hint).toBeVisible();

    const card = page.locator('.wrong-item');
    await card.getByRole('button', { name: '移出待複習' }).click();
    await expect(card.getByText('已移出待複習')).toBeFocused();
    const after = await stored(page);
    expect(after.wrong).toEqual({});
    expect(Object.keys(after.stars)).toEqual([idOf(q1)]);
    await expect(hint).toHaveCount(0);
  });

  test('答錯之後手動移出、重新整理、繼續測驗、完成：不會被加回來', async ({ page }) => {
    await gotoHome(page, { wrong: { [idOf(q1)]: { streak: 0, last: 1 } } });
    await startDrill(page, 'review:wrong');
    await answer(page, q1, false);
    await expect(page.getByText('要連續答對 2 次')).toBeVisible();
    await page.getByRole('button', { name: '移出待複習' }).click();
    await page.reload();
    await page.getByRole('button', { name: '繼續測驗' }).click();
    await page.getByRole('button', { name: /完成測驗/ }).click();
    await expect(page.getByRole('button', { name: /再測一次/ })).toBeVisible();
    expect((await stored(page)).wrong).toEqual({});
  });

  test('同一份進度在兩個分頁都完成：只算一次，不會一場就移出', async ({ page, context }) => {
    await gotoHome(page, { wrong: { [idOf(q1)]: { streak: 0, last: 1 } } });
    await startDrill(page, 'review:wrong');
    await answer(page, q1, true);

    const other = await context.newPage();
    await gotoHome(other);
    await other.getByRole('button', { name: '繼續測驗' }).click();
    await page.getByRole('button', { name: /完成測驗/ }).click();
    await expect(page.getByRole('button', { name: /再測一次/ })).toBeVisible();
    await other.getByRole('button', { name: /完成測驗/ }).click();
    await expect(other.getByRole('button', { name: /再測一次/ })).toBeVisible();
    expect((await stored(page)).wrong[idOf(q1)].streak).toBe(1);
  });

  test('考試模式：星號能用，待複習的狀態到結果頁才看得到', async ({ page }) => {
    await gotoHome(page, { wrong: { [idOf(q1)]: { streak: 1, last: 1 } } });
    await startDrill(page, 'review:wrong', 'exam');
    await answer(page, q1, false);
    await star(page).click();
    await expect(star(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId(`option-${q1.options.find((o) => o.key !== q1.answer)!.key}`).locator('input')).toBeChecked();
    await expect(page.getByRole('button', { name: '移出待複習' })).toHaveCount(0);
    await expect(page.getByText(/再答對/)).toHaveCount(0);
    await expect(page.locator('.option-icon')).toHaveCount(0);

    await page.getByRole('button', { name: /完成測驗/ }).click();
    await expect(page.locator('.wrong-item').getByRole('button', { name: '移出待複習' })).toBeVisible();
    await expect(page.locator('.wrong-item').getByRole('button', { name: '第 1 題加星號' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('開始之後取消星號、重新整理、繼續測驗：進度還在，清單不變', async ({ page }) => {
    await gotoHome(page, { stars: [q1, q2, q3].map(idOf) });
    await startDrill(page, 'review:starred');
    await expect(progress(page)).toHaveText('1 / 3');
    await answer(page, q1, true);
    await page.getByRole('button', { name: /下一題/ }).click();
    await expect(progress(page)).toHaveText('2 / 3');
    const second = await stem(page).textContent();

    await star(page).click();
    await expect(star(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(progress(page)).toHaveText('2 / 3');
    await expect(stem(page)).toHaveText(second!);

    await page.reload();
    await expect(page.getByRole('button', { name: '繼續測驗' }), '進度被當成壞進度丟掉了').toBeVisible();
    await page.getByRole('button', { name: '繼續測驗' }).click();
    await expect(progress(page)).toHaveText('2 / 3');
    await expect(stem(page)).toHaveText(second!);
    expect(Object.keys((await stored(page)).stars)).toHaveLength(2);
  });

  test('兩個分頁各加一顆星：兩顆都留下，第三個分頁的題數不用重新整理就更新', async ({ page, context }) => {
    const other = await context.newPage();
    const watcher = await context.newPage();
    // 背景分頁被瀏覽器凍結時收不到 storage 事件，手上是舊的快照。不擋這個事件，這條測試驗不出沿用快照的寫入：
    // 事件一到快照就更新了
    await other.addInitScript(() => {
      window.addEventListener('storage', (e) => e.stopImmediatePropagation(), true);
    });
    await gotoHome(page);
    await gotoHome(other);
    await gotoHome(watcher);
    for (const p of [page, other]) {
      await p.getByLabel('隨機出題順序').uncheck();
      await startButton(p).click();
      await expect(p.locator('.question-card')).toBeVisible();
    }
    await other.getByRole('button', { name: /下一題/ }).click();
    await expect(progress(other)).toHaveText('2 / 20');

    await star(page).click();
    await expect(star(page)).toHaveAttribute('aria-pressed', 'true');
    await star(other).click();
    await expect(star(other)).toHaveAttribute('aria-pressed', 'true');

    expect(Object.keys((await stored(page)).stars)).toHaveLength(2);
    await expect
      .poll(() => optionLabel(watcher, 'review:starred'), { timeout: 5000 })
      .toBe('星號題（2 題）');
  });

  test('存不進去：畫面上說沒有儲存，星號維持原狀', async ({ page }) => {
    await page.addInitScript((key) => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k: string, v: string) {
        if (k === key) throw new DOMException('quota', 'QuotaExceededError');
        set.call(this, k, v);
      };
    }, KEY);
    await gotoHome(page);
    await page.getByLabel('隨機出題順序').uncheck();
    await startButton(page).click();
    await star(page).click();
    const notice = page.getByRole('status').filter({ hasText: '這次變更沒有儲存' });
    await expect(notice).toBeVisible();
    await expect(star(page)).toHaveAttribute('aria-pressed', 'false');

    // 往下捲之後還看得到，不會被 sticky 的 header 蓋住
    await page.setViewportSize({ width: 390, height: 500 });
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    const header = (await page.locator('.app-header').boundingBox())!;
    const box = (await notice.boundingBox())!;
    expect(box.y, '說明被 header 蓋住').toBeGreaterThanOrEqual(header.y + header.height);
    expect(box.y + box.height).toBeLessThanOrEqual(500);
  });

  test('壞資料：原始內容搬到 :corrupt，畫面上有說明，之後照常使用', async ({ page }) => {
    await page.addInitScript((key) => {
      if (!window.sessionStorage.getItem('seeded')) {
        window.sessionStorage.setItem('seeded', '1');
        window.localStorage.setItem(key, '{broken');
      }
    }, KEY);
    await gotoHome(page);
    await expect(page.getByRole('status').filter({ hasText: '原始內容已另存' })).toBeVisible();
    expect(await page.evaluate((key) => window.localStorage.getItem(`${key}:corrupt`), KEY)).toBe('{broken');
    expect(await stored(page)).toMatchObject({ stars: {}, wrong: {} });
  });

  test('鍵盤：Tab 到星號，空白鍵與 Enter 都能切換，焦點不動，選好的答案還在', async ({ page }) => {
    await gotoHome(page, { wrong: { [idOf(q1)]: { streak: 0, last: 1 } } });
    await startDrill(page, 'review:wrong', 'exam');
    const option = page.getByTestId(`option-${q1.options[1].key}`).locator('input');
    await option.focus();
    await page.keyboard.press('Space');
    await expect(option).toBeChecked();

    let reached = false;
    for (let i = 0; i < 6 && !reached; i++) {
      await page.keyboard.press('Shift+Tab');
      reached = await star(page).evaluate((el) => el === document.activeElement);
    }
    expect(reached, 'Shift+Tab 應在 6 次內從選項回到星號').toBe(true);

    await page.keyboard.press('Space');
    await expect(star(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(star(page)).toBeFocused();
    await expect(option).toBeChecked();

    await page.keyboard.press('Enter');
    await expect(star(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(star(page)).toBeFocused();
    await expect(option).toBeChecked();
  });

  for (const dark of [false, true]) {
    const name = dark ? '深色' : '淺色';

    test(`高對比${name}：滑鼠移到星號上，圖示看得見，加了與沒加都一樣`, async ({ page }) => {
      await page.addInitScript(
        (darkMode) => window.localStorage.setItem('ipas-quiz-a11y', JSON.stringify({ highContrast: true, darkMode })),
        dark
      );
      await gotoHome(page, { stars: [idOf(q1)] });
      await startDrill(page, 'review:starred');
      await star(page).hover();
      expect(await star(page).evaluate((el) => el.matches(':hover'))).toBe(true);
      expect(await starContrast(star(page)), '加了星號、滑鼠在上面').toBeGreaterThanOrEqual(3);
      await star(page).click();
      await expect(star(page)).toHaveAttribute('aria-pressed', 'false');
      expect(await starContrast(star(page)), '沒有星號、滑鼠在上面').toBeGreaterThanOrEqual(3);
    });

    test(`高對比${name}：觸控點完，:hover 還留著時圖示看得見`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({ baseURL, hasTouch: true, viewport: { width: 390, height: 800 } });
      const page = await context.newPage();
      await page.addInitScript(
        (darkMode) => window.localStorage.setItem('ipas-quiz-a11y', JSON.stringify({ highContrast: true, darkMode })),
        dark
      );
      await gotoHome(page, { stars: [idOf(q1)] });
      await startDrill(page, 'review:starred');
      await star(page).tap();
      await expect(star(page)).toHaveAttribute('aria-pressed', 'false');
      expect(await starContrast(star(page))).toBeGreaterThanOrEqual(3);
      await star(page).tap();
      await expect(star(page)).toHaveAttribute('aria-pressed', 'true');
      expect(await starContrast(star(page))).toBeGreaterThanOrEqual(3);
      await context.close();
    });
  }

  test('圖示字型被擋：星號不變成文字，不壓到旗標', async ({ page }) => {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await gotoHome(page, { stars: [idOf(q1)] });
    await startDrill(page, 'review:starred');
    expect(await star(page).textContent()).toBe('');
    const box = (await star(page).boundingBox())!;
    const flag = (await page.getByRole('link', { name: '回報此題的問題' }).boundingBox())!;
    expect(box.x + box.width, '星號壓到旗標').toBeLessThanOrEqual(flag.x);
  });

  test('確認對話框：預設焦點在取消，連按兩下 Enter 不會清掉；Tab 出不去；關閉後焦點回到原按鈕', async ({ page }) => {
    await gotoHome(page, { stars: [idOf(q1)] });
    await page.getByRole('button', { name: '開啟設定' }).click();
    const open = page.getByRole('button', { name: '清除星號' });
    await open.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused();

    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement)), 'Tab 跑出了對話框').toBe(true);
    }
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement)), 'Shift+Tab 跑出了對話框').toBe(true);
    }

    await dialog.getByRole('button', { name: '取消' }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();
    expect(Object.keys((await stored(page)).stars)).toEqual([idOf(q1)]);
  });

  test('一般螢幕：按鈕至少 24px', async ({ page }) => {
    await gotoHome(page, { stars: [idOf(q1)] });
    await startDrill(page, 'review:starred');
    const box = await layoutSize(star(page));
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
  });

  test('寬螢幕的觸控裝置：按鈕也至少 44px', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, hasTouch: true, viewport: { width: 1024, height: 768 } });
    const page = await context.newPage();
    await gotoHome(page, { stars: [idOf(q1)] });
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    await startDrill(page, 'review:starred');
    const box = await layoutSize(star(page));
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await context.close();
  });

  // 標頭裡標籤最多、最寬的是官方題，桌面版標頭不換行
  for (const width of [641, 768]) {
    test(`${width}px、最大字級的官方題：星號留在題卡裡`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await gotoHome(page, undefined, 'xlarge');
      await startDrill(page, 'official');
      const box = (await star(page).boundingBox())!;
      const card = (await page.locator('.question-card').boundingBox())!;
      expect(box.x + box.width, '星號凸出題卡').toBeLessThanOrEqual(card.x + card.width);
      expect(await horizontalOverflow(page)).toBe(0);
    });
  }

  // 全題庫都加星號時選項最長。欄寬在 auto-fit 換欄的地方最窄，那個寬度隨字級變，所以逐一掃過
  for (const fontSize of ['normal', 'large', 'xlarge'] as const) {
    test(`字級 ${fontSize}、最長的題數：每一種寬度都放得下每一個選項`, async ({ page }) => {
      test.setTimeout(240_000);
      await gotoHome(page, { stars: everyId }, fontSize);
      await expect
        .poll(() => optionLabel(page, 'review:both'), { timeout: 20_000 })
        .toMatch(/^星號 \+ 待複習錯題（\d{4} 題）$/);

      const widths: number[] = [];
      for (let w = 320; w <= 1000; w += 6) widths.push(w);
      for (let w = 1000; w <= 1600; w += 40) widths.push(w);
      const cut: string[] = [];
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        cut.push(...(await cutOptions(page)).map((c) => `${width}px ${c}`));
      }
      expect(cut, '題目來源的選項選中時會被截掉一段').toEqual([]);
    });
  }

  // 最大字級最容易把頁面撐寬
  for (const fontSize of ['normal', 'xlarge'] as const) {
    for (const width of [320, 360, 390]) {
      test(`手機 ${width}px、字級 ${fontSize}：選項放得下、星號至少 44px、三個頁面都不橫向捲動`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        const ids = bank.map(idOf);
        await gotoHome(
          page,
          {
            stars: ids.slice(0, 300),
            wrong: Object.fromEntries(ids.map((id) => [id, { streak: 1, last: 1 }])),
          },
          fontSize
        );

        expect(await cutOptions(page), '題目來源的選項選中時會被截掉一段').toEqual([]);
        expect(await horizontalOverflow(page), '首頁被撐寬').toBe(0);

        await startDrill(page, 'review:both');
        const size = await layoutSize(star(page));
        expect(size.width).toBeGreaterThanOrEqual(44);
        expect(size.height).toBeGreaterThanOrEqual(44);
        const box = (await star(page).boundingBox())!;
        expect(box.x + box.width, '星號凸出畫面').toBeLessThanOrEqual(width);
        expect(await horizontalOverflow(page), '測驗頁被撐寬').toBe(0);

        // 不隨機時官方題排在前面，第一題不一定是 q1
        const shown = await stem(page).textContent();
        await answer(page, bank.find((q) => q.stem === shown)!, false);
        await expect(page.getByRole('button', { name: '移出待複習' })).toBeVisible();
        await expect(page.getByText('要連續答對 2 次')).toBeVisible();
        expect(await horizontalOverflow(page), '答案揭曉後被撐寬').toBe(0);

        await page.getByRole('button', { name: /結束並返回首頁/ }).click();
        await page.getByRole('button', { name: '結束並返回', exact: true }).click();
        await page.getByRole('button', { name: '開啟設定' }).click();
        await expect(page.getByRole('heading', { name: '星號與待複習錯題' })).toBeVisible();
        expect(await horizontalOverflow(page), '設定頁被撐寬').toBe(0);
        for (const name of ['匯出備份', '匯入備份', '清除星號', '清除待複習錯題']) {
          const button = page.getByRole('button', { name });
          const b = (await button.boundingBox())!;
          expect(b.x + b.width, `${name} 凸出畫面`).toBeLessThanOrEqual(width);
          expect((await layoutSize(button)).height, `${name} 太小`).toBeGreaterThanOrEqual(44);
        }
      });
    }
  }

  test('結果頁的錯題卡：手機寬度星號至少 44px，不橫向捲動', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await gotoHome(page, { stars: [idOf(q1)] });
    await startDrill(page, 'review:starred');
    await answer(page, q1, false);
    await page.getByRole('button', { name: /完成測驗/ }).click();
    const button = page.locator('.wrong-item').getByRole('button', { name: '第 1 題加星號' });
    const box = await layoutSize(button);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await horizontalOverflow(page)).toBe(0);
  });

  test('匯出之後在全新的瀏覽器環境匯入：先看題數，確認才合併，原有的紀錄還在', async ({ page, browser, baseURL }) => {
    await gotoHome(page, {
      stars: [idOf(q1)],
      wrong: { [idOf(q2)]: { streak: 1, last: 5 } },
    });
    await page.getByRole('button', { name: '開啟設定' }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '匯出備份' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^ipas-review-\d{4}-\d{2}-\d{2}\.json$/);
    const buffer = readFileSync(await download.path());
    expect(JSON.parse(buffer.toString('utf-8'))).toMatchObject({
      app: 'ipas-net-zero-quiz',
      schema: 1,
      stars: { [idOf(q1)]: 1 },
      wrong: { [idOf(q2)]: { streak: 1, last: 5 } },
    });

    const fresh = await browser.newContext({ baseURL });
    const other = await fresh.newPage();
    await gotoHome(other, { stars: [idOf(q3)] });
    await other.getByRole('button', { name: '開啟設定' }).click();
    const input = other.locator('input[type="file"]');

    // 壞檔案：不開確認、什麼都不寫，並說出原因
    await input.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{oops') });
    await expect(other.getByText('沒有匯入：這個檔案不是備份檔，內容無法讀取。')).toBeVisible();
    await expect(other.getByRole('dialog')).toHaveCount(0);
    expect(Object.keys((await stored(other)).stars)).toEqual([idOf(q3)]);

    await input.setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer });
    const dialog = other.getByRole('dialog');
    await expect(dialog).toContainText('備份裡有星號 1 題、待複習錯題 1 題，會新增星號 1 題、待複習錯題 1 題。');
    expect(Object.keys((await stored(other)).stars)).toEqual([idOf(q3)]);
    await dialog.getByRole('button', { name: '確定合併' }).click();
    await expect(other.getByText('已合併：新增星號 1 題、待複習錯題 1 題。')).toBeVisible();

    await input.setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer });
    await expect(dialog).toContainText('不會新增');
    await dialog.getByRole('button', { name: '確定合併' }).click();
    await expect(other.getByText('沒有新增：備份裡的題目都已經在清單裡。')).toBeVisible();

    await other.reload();
    expect(await optionLabel(other, 'review:starred')).toBe('星號題（2 題）');
    expect(await optionLabel(other, 'review:wrong')).toBe('待複習錯題（1 題）');
    expect(await optionLabel(other, 'review:both')).toBe('星號 + 待複習錯題（3 題）');
    await fresh.close();
  });

  test('清除星號要確認，不影響待複習與作答統計', async ({ page }) => {
    await gotoHome(page, { stars: [idOf(q1)], wrong: { [idOf(q2)]: { streak: 0, last: 1 } } });
    await page.evaluate(() =>
      window.localStorage.setItem(
        'ipas-question-stats',
        JSON.stringify({ version: 1, items: { x: { attempts: 1, correct: 1, lastTriedAt: 1 } } })
      )
    );
    await page.getByRole('button', { name: '開啟設定' }).click();
    await page.getByRole('button', { name: '清除星號' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '確定清除' }).click();
    await expect(page.getByText('已清除星號。')).toBeVisible();
    const after = await stored(page);
    expect(after.stars).toEqual({});
    expect(Object.keys(after.wrong)).toEqual([idOf(q2)]);
    expect(await page.evaluate(() => window.localStorage.getItem('ipas-question-stats'))).not.toBeNull();
  });

  // issue #148：所有者要確認錯題紀錄記得到這一題。用真實題庫走官方題目的路徑，不塞假資料
  test.describe('issue #148：115 年第一次公告試題考科二第 6 題', () => {
    const ID = 'S_IPAS_115_01_L12-q006';
    const target = dataset.our_unique_items.find((q) => q.item_id === ID)!;
    const official = dataset.our_unique_items.filter(
      (q) => q.official_exam?.session === '115-01' && q.official_exam.subject === 'L12'
    );
    const wrongKey = 'D';

    test.beforeAll(() => {
      // 題庫的答案改了，這幾條測試的前提就不成立，要重寫，不是改斷言
      expect(target.answer).toBe('B');
      expect(target.options.map((o) => o.key)).toContain(wrongKey);
    });

    const correctOption = (page: Page) => page.locator('.question-card .option-item.correct');
    const wrongOption = (page: Page) => page.locator('.question-card .option-item.incorrect');

    /** 只出官方題目、115 年第一次、考科二、不隨機、6 題；前 5 題考試模式要作答才能下一題，照官方答案答 */
    async function reachTarget(page: Page, mode: 'practice' | 'exam') {
      await page.getByLabel('考科範圍').selectOption('考科2');
      await source(page).selectOption('exam:115-01');
      await page.getByLabel('測驗模式').selectOption(mode);
      await page.getByLabel('隨機出題順序').uncheck();
      await page.getByLabel('題數').fill('6');
      await startButton(page).click();
      for (let i = 1; i < 6; i++) {
        await expect(progress(page)).toHaveText(`${i} / 6`);
        if (mode === 'exam') {
          const shown = await stem(page).textContent();
          await answer(page, official.find((q) => q.stem === shown)!, true);
        }
        await page.getByRole('button', { name: /下一題/ }).click();
      }
      await expect(progress(page)).toHaveText('6 / 6');
      await expect(stem(page)).toHaveText(target.stem);
    }

    /** 結果頁這一題的錯題卡：你的答案 D、正確答案 B，勾在 B、叉在 D */
    async function expectResultCard(page: Page) {
      const card = page.locator('.wrong-item').filter({ hasText: target.stem });
      await expect(card).toHaveCount(1);
      await expect(card.locator('.your-answer strong')).toHaveText(wrongKey);
      await expect(card.locator('.correct-answer strong')).toHaveText(target.answer);
      await expect(card.locator('.wrong-option--correct .wrong-option__key')).toHaveText(target.answer);
      await expect(card.locator('.wrong-option--correct [aria-label="正確答案"]')).toHaveCount(1);
      await expect(card.locator('.wrong-option--selected .wrong-option__key')).toHaveText(wrongKey);
      await expect(card.locator('.wrong-option--selected [aria-label="你的答案"]')).toHaveCount(1);
    }

    test('練習模式答錯，記進待複習；之後連續兩場答對才移出', async ({ page }) => {
      await gotoHome(page);
      await reachTarget(page, 'practice');
      await page.getByTestId(`option-${wrongKey}`).click();
      await expect(correctOption(page)).toHaveAttribute('data-testid', `option-${target.answer}`);
      await expect(wrongOption(page)).toHaveAttribute('data-testid', `option-${wrongKey}`);
      await page.getByRole('button', { name: /完成測驗/ }).click();

      expect((await stored(page)).wrong[ID]).toMatchObject({ streak: 0 });
      await expectResultCard(page);

      await page.getByRole('button', { name: /返回首頁/ }).click();
      await page.getByLabel('考科範圍').selectOption('考科2');
      expect(await optionLabel(page, 'review:wrong')).toBe('待複習錯題（1 題）');
      await startDrill(page, 'review:wrong');
      await expect(stem(page)).toHaveText(target.stem);
      await page.getByTestId(`option-${target.answer}`).click();
      await expect(correctOption(page)).toHaveAttribute('data-testid', `option-${target.answer}`);
      await expect(wrongOption(page)).toHaveCount(0);
      await expect(page.getByText('再答對 1 次移出')).toBeVisible();
      await page.getByRole('button', { name: /完成測驗/ }).click();
      expect((await stored(page)).wrong[ID]).toMatchObject({ streak: 1 });

      await page.getByRole('button', { name: /再測一次/ }).click();
      await expect(stem(page)).toHaveText(target.stem);
      await page.getByTestId(`option-${target.answer}`).click();
      await expect(correctOption(page)).toHaveAttribute('data-testid', `option-${target.answer}`);
      await expect(page.getByText('這場結束會移出')).toBeVisible();
      await page.getByRole('button', { name: /完成測驗/ }).click();
      await expect(page.getByText('這場有 1 題移出。')).toBeVisible();
      expect((await stored(page)).wrong[ID]).toBeUndefined();
    });

    test('考試模式答錯：作答中看不到對錯與待複習，結束後一樣記進去', async ({ page }) => {
      // 先放進待複習、已經答對過一次：作答中漏出狀態的話，畫面上會有進度
      await gotoHome(page, { wrong: { [ID]: { streak: 1, last: 1 } } });
      await reachTarget(page, 'exam');
      await page.getByTestId(`option-${wrongKey}`).click();
      await expect(page.getByTestId(`option-${wrongKey}`).locator('input')).toBeChecked();
      await expect(page.locator('.option-icon')).toHaveCount(0);
      await expect(correctOption(page)).toHaveCount(0);
      await expect(wrongOption(page)).toHaveCount(0);
      await expect(page.getByRole('button', { name: '移出待複習' })).toHaveCount(0);
      await expect(page.getByText(/再答對|要連續答對|這場結束會移出|已進待複習/)).toHaveCount(0);
      await page.getByRole('button', { name: /完成測驗/ }).click();

      expect((await stored(page)).wrong[ID]).toMatchObject({ streak: 0 });
      // 前 5 題照官方答案答，只有這一題答錯
      expect(Object.keys((await stored(page)).wrong)).toEqual([ID]);
      await expectResultCard(page);
    });

    test('加星號、重新整理、星號題練習：同一題，正確答案是 B', async ({ page }) => {
      await gotoHome(page);
      await reachTarget(page, 'practice');
      await star(page).click();
      await expect(star(page)).toHaveAttribute('aria-pressed', 'true');
      expect(Object.keys((await stored(page)).stars)).toEqual([ID]);

      await page.reload();
      await startDrill(page, 'review:starred');
      await expect(progress(page)).toHaveText('1 / 1');
      await expect(stem(page)).toHaveText(target.stem);
      await expect(star(page)).toHaveAttribute('aria-pressed', 'true');
      await page.getByTestId(`option-${target.answer}`).click();
      await expect(correctOption(page)).toHaveAttribute('data-testid', `option-${target.answer}`);
      await expect(wrongOption(page)).toHaveCount(0);
    });
  });
});

/** 題卡進場的動畫跑完：量位置之前要等，不然量到的是 transform 途中的位置 */
const settleAnimations = (page: Page) =>
  page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));

/** 星號在視窗裡的位置與頁面捲動量 */
const starSpot = (page: Page) =>
  star(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, left: r.left, scrollY: window.scrollY };
  });

test.describe('第一次加星號的提示不推動版面（Discussion #1）', () => {
  for (const { name, viewport, hasTouch } of [
    { name: '桌面', viewport: { width: 1280, height: 720 }, hasTouch: false },
    { name: '1024px 觸控', viewport: { width: 1024, height: 768 }, hasTouch: true },
    { name: '412px 觸控（Pixel 7 的寬度）', viewport: { width: 412, height: 839 }, hasTouch: true },
  ]) {
    test(`${name}：加星號與取消都不移動星號、不捲動頁面，第二下點同一個位置就是取消`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({ baseURL, hasTouch, viewport });
      const page = await context.newPage();
      await gotoHome(page);
      await page.getByLabel('隨機出題順序').uncheck();
      await startButton(page).click();
      await expect(page.locator('.question-card')).toBeVisible();
      await settleAnimations(page);
      const tap = (x: number, y: number) => (hasTouch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));

      const before = await starSpot(page);
      await tap(before.x, before.y);
      await expect(star(page)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.review-notice')).toHaveText(/已加星號/);
      await settleAnimations(page);
      expect(await starSpot(page), '第一次加星號之後').toEqual(before);

      await tap(before.x, before.y);
      await expect(star(page), '第二下點到的不是星號').toHaveAttribute('aria-pressed', 'false');
      await settleAnimations(page);
      expect(await starSpot(page), '取消星號之後').toEqual(before);
      await context.close();
    });
  }
});

/** 有焦點的元素沒有被頁首或星號的提示蓋住（WCAG 2.4.11）：與兩者都不重疊，也在視窗裡 */
async function expectNotCovered(target: Locator, where: string): Promise<void> {
  const m = await target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const header = document.querySelector('.app-header')!.getBoundingClientRect();
    const notice = document.querySelector('.review-notice')!.getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      headerBottom: header.bottom,
      noticeTop: notice.top,
      noticeBottom: notice.bottom,
      noticeHeight: notice.height,
      viewport: window.innerHeight,
    };
  });
  const info = `${where} ${JSON.stringify(m)}`;
  expect(m.noticeHeight, `提示要在畫面上 ${info}`).toBeGreaterThan(0);
  expect(m.top, `被頁首蓋住 ${info}`).toBeGreaterThanOrEqual(m.headerBottom);
  expect(m.top < m.noticeBottom && m.bottom > m.noticeTop, `被提示蓋住 ${info}`).toBe(false);
  expect(m.bottom, `在視窗外 ${info}`).toBeLessThanOrEqual(m.viewport);
}

test.describe('星號的提示不蓋住有焦點的題幹、選項與鍵盤提示（WCAG 2.4.11）', () => {
  for (const { name, viewport } of [
    { name: '桌面', viewport: { width: 1280, height: 720 } },
    { name: 'Pixel 7 的大小', viewport: { width: 412, height: 839 } },
  ]) {
    for (const fontSize of ['normal', 'large', 'xlarge'] as const) {
      test(`${name}、字級 ${fontSize}：加星號之後用鍵盤作答、下一題、走過每一個選項`, async ({ browser, baseURL }) => {
        const context = await browser.newContext({ baseURL, viewport });
        const page = await context.newPage();
        await gotoHome(page, undefined, fontSize);
        await page.getByLabel('隨機出題順序').uncheck();
        await startButton(page).click();
        await expect(page.locator('.question-card')).toBeVisible();
        await star(page).click();
        await expect(page.locator('.review-notice')).toHaveText(/已加星號/);

        const options = page.locator('.question-options input[type="radio"]');
        const walkOptions = async (question: string) => {
          await page.locator('.question-feedback-link').focus();
          await page.keyboard.press('Tab');
          const count = await options.count();
          for (let i = 0; i < count; i++) {
            if (i > 0) await page.keyboard.press('ArrowDown');
            await expect(options.nth(i)).toBeFocused();
            await expectNotCovered(page.locator('.option-item').nth(i), `${question}選項 ${i + 1}`);
            await expectNotCovered(page.locator('.option-keyboard-hint span'), `${question}選項 ${i + 1} 的鍵盤提示`);
          }
          return count;
        };

        const count = await walkOptions('第 1 題');
        await page.keyboard.press('Enter');
        const next = page.getByRole('button', { name: /下一題/ });
        await expect(next).toBeFocused();
        await expectNotCovered(next, `作答第 ${count} 個選項之後的下一題按鈕`);
        await page.keyboard.press('Enter');
        await expect(progress(page)).toHaveText(/^2 \//);
        await expect(page.locator('.question-stem')).toBeFocused();
        await settleAnimations(page);
        await expectNotCovered(page.locator('.question-stem'), '下一題的題幹');
        await walkOptions('第 2 題');
        await context.close();
      });
    }
  }
});

test('提示在畫面上時捲到最底：頁尾整個在提示上方，連結不被蓋住', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 839 });
  await gotoHome(page, undefined, 'xlarge');
  await page.getByLabel('隨機出題順序').uncheck();
  await startButton(page).click();
  await star(page).click();
  await expect(page.locator('.review-notice')).toHaveText(/已加星號/);
  await page.locator('.app-footer a').last().focus();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expectNotCovered(page.locator('.app-footer'), '捲到最底的頁尾');
});
