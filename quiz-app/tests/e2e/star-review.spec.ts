import { readFileSync } from 'node:fs';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { test, expect, stubVisitorCounter } from './fixtures';

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

/**
 * 主內容第一次畫出來時，星號與待複習的說明在不在（init script）：開頁就有的說明要第一次畫出來就在，
 * 不能等使用者開始操作才把內容往下推。主內容一出現就排一個 requestAnimationFrame，在畫之前量
 */
const recordFirstPaint = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as { __firstPaint?: string };
    new MutationObserver((_, observer) => {
      const main = document.getElementById('main-content');
      if (main && main.children.length > 0) {
        observer.disconnect();
        requestAnimationFrame(() => {
          w.__firstPaint = main.querySelector('.review-notice')?.textContent ?? '';
        });
      }
    }).observe(document, { childList: true, subtree: true });
  });
const firstPaint = (page: Page) => page.evaluate(() => (window as unknown as { __firstPaint?: string }).__firstPaint);

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
    const hint = page.locator('.review-notice', { hasText: '已加星號，首頁「題目來源」選「星號題」可以反覆練習。' });
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
    await expect(page.locator('.action-notice')).toHaveText('目前沒有待複習錯題可以再測一次，回首頁可以選其他題目來源。');
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
    // 說在星號那一列（題卡標頭）的正下方，螢幕閱讀器也念得到
    await expect(page.locator('.question-header + .review-notice')).toHaveText(/這次變更沒有儲存/);
    await expect(page.locator('.review-notice')).toBeVisible();
    await expect(page.locator('.review-live')).toHaveText(/這次變更沒有儲存/);
    await expect(star(page)).toHaveAttribute('aria-pressed', 'false');
  });

  test('壞資料：原始內容搬到 :corrupt，畫面上有說明，之後照常使用', async ({ page }) => {
    await page.addInitScript((key) => {
      if (!window.sessionStorage.getItem('seeded')) {
        window.sessionStorage.setItem('seeded', '1');
        window.localStorage.setItem(key, '{broken');
      }
    }, KEY);
    await recordFirstPaint(page);
    await gotoHome(page);
    await expect(page.locator('#main-content > .review-notice')).toHaveText(/原始內容已另存/);
    expect(await firstPaint(page), '說明不是第一次畫出來就在').toMatch(/原始內容已另存/);
    await expect(page.locator('.review-live')).toHaveText(/原始內容已另存/);
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
      // 自己開的 context 沒有經過 fixtures.ts 的 test，計數器要自己擋
      await stubVisitorCounter(context);
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
    // 自己開的 context 沒有經過 fixtures.ts 的 test，計數器要自己擋
    await stubVisitorCounter(context);
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
    // 自己開的 context 沒有經過 fixtures.ts 的 test，計數器要自己擋
    await stubVisitorCounter(fresh);
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

/** 進場的淡入跑完：量位置與點擊之前要等 */
const settleAnimations = (page: Page) =>
  page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));

/** 等兩個 frame */
const nextFrames = (page: Page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

const TIP = '已加星號，首頁「題目來源」選「星號題」可以反覆練習。';

/**
 * 星號在視窗裡的位置與頁面捲動量、點它的中間點到的是不是它；每一個提示是不是排在文件流裡，
 * 與星號、有焦點的元素重不重疊
 */
const starState = (button: Locator) =>
  button.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    const active = document.activeElement;
    const focus = active && active !== document.body ? active.getBoundingClientRect() : null;
    const overlap = (a: DOMRect, b: DOMRect) => a.top < b.bottom && a.bottom > b.top && a.left < b.right && a.right > b.left;
    return {
      x,
      y,
      top: r.top,
      left: r.left,
      scrollY: window.scrollY,
      hitIsStar: hit !== null && el.contains(hit),
      notices: [...document.querySelectorAll('.review-notice')].map((n) => {
        const box = n.getBoundingClientRect();
        return {
          position: getComputedStyle(n).position,
          overStar: overlap(box, r),
          overFocus: focus !== null && overlap(box, focus),
        };
      }),
    };
  });

type StarState = Awaited<ReturnType<typeof starState>>;
const sameSpot = (s: StarState) => ({ top: s.top, left: s.left, scrollY: s.scrollY });

/** 把元素捲到視窗底部上方 20px */
const toViewportBottom = (target: Locator) =>
  target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    window.scrollBy(0, r.bottom - (window.innerHeight - 20));
  });

/**
 * 題目頁捲回最上面（開始按鈕在首頁下方，換到題目頁時還捲在那裡）；星號在視窗底部上方 20px 以下的話
 * （320x256 字級特大），捲到那裡
 */
async function starInView(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await star(page).boundingBox();
  if (box!.y + box!.height > page.viewportSize()!.height - 20) await toViewportBottom(star(page));
}

type Way = '滑鼠' | '觸控' | 'Space' | 'Enter';
const ways: Way[] = ['滑鼠', '觸控', 'Space', 'Enter'];

/**
 * 用同一種方式按兩下星號：第一下加星號（每次都先當作沒看過提示，提示才會出現），第二下在同一個位置取消。
 * 星號不移動、頁面不捲動、提示排在 row 那一列的正下方、在文件流裡、不與星號或有焦點的元素重疊
 */
async function toggleTwice(page: Page, button: Locator, way: Way, row: string): Promise<void> {
  await page.evaluate(() => window.localStorage.removeItem('ipas-review-star-hint-seen'));
  const keyboard = way === 'Space' || way === 'Enter';
  if (keyboard) await button.focus();
  await settleAnimations(page);
  const before = await starState(button);
  const press = async () => {
    if (way === '滑鼠') await page.mouse.click(before.x, before.y);
    else if (way === '觸控') await page.touchscreen.tap(before.x, before.y);
    else await page.keyboard.press(way);
  };

  await press();
  await expect(button, `${way}：第一下沒有加上星號`).toHaveAttribute('aria-pressed', 'true');
  const tip = page.locator(`${row} + .review-notice`);
  await expect(tip).toHaveText(TIP);
  await expect(tip).toBeVisible();
  await settleAnimations(page);
  const after = await starState(button);
  const info = `${way} ${JSON.stringify(after)}`;
  expect(sameSpot(after), `星號移動了 ${info}`).toEqual(sameSpot(before));
  expect(after.hitIsStar, `點同一個位置點到的不是星號 ${info}`).toBe(true);
  expect(after.notices.map((n) => n.position), `提示不在文件流裡 ${info}`).toEqual(['static']);
  expect(after.notices.filter((n) => n.overStar || n.overFocus), `提示與星號或焦點重疊 ${info}`).toEqual([]);
  if (keyboard) await expect(button).toBeFocused();

  await press();
  await expect(button, `${way}：第二下沒有取消星號`).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.review-notice')).toHaveCount(0);
  await settleAnimations(page);
  expect(sameSpot(await starState(button)), `${way}：取消之後星號移動了`).toEqual(sameSpot(before));
  if (keyboard) await expect(button).toBeFocused();
}

const toggleViewports = [
  { name: '1280x720', viewport: { width: 1280, height: 720 }, fontSize: 'normal' as const },
  { name: 'Pixel 7 的大小', viewport: { width: 412, height: 839 }, fontSize: 'normal' as const },
  // 1280x1024 放大 400%
  { name: '320x256 字級特大', viewport: { width: 320, height: 256 }, fontSize: 'xlarge' as const },
];

/** 三題待複習錯題都答錯，到結果頁：錯題卡上的星號都還沒按過 */
async function toResultWithWrongCards(page: Page, fontSize: 'normal' | 'large' | 'xlarge'): Promise<void> {
  const qs = [q1, q2, q3];
  await gotoHome(page, { wrong: Object.fromEntries(qs.map((q) => [idOf(q), { streak: 0, last: 1 }])) }, fontSize);
  await startDrill(page, 'review:wrong');
  for (let i = 0; i < qs.length; i++) {
    const text = await stem(page).textContent();
    await answer(page, qs.find((q) => q.stem === text)!, false);
    if (i < qs.length - 1) await page.getByRole('button', { name: /下一題/ }).click();
  }
  await page.getByRole('button', { name: /完成測驗/ }).click();
  await expect(page.locator('.wrong-item')).toHaveCount(3);
  await settleAnimations(page);
}

// 提示排在文件流裡，排在按下去的那顆星號那一列的下面：上面的東西都不動，星號不從指標底下移走。
// 之前固定在視窗邊上、猜哪一邊不會蓋住剛按的東西，五輪複審每一輪都找到新的情形（Discussion #1）
test.describe('星號的提示排在那一列下面：加星號與取消都不移動星號，第二下在同一個位置就是取消', () => {
  for (const { name, viewport, fontSize } of toggleViewports) {
    test(`題目頁 ${name}：滑鼠、觸控、空白鍵、Enter`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({ baseURL, hasTouch: true, viewport });
      // 自己開的 context 沒有經過 fixtures.ts 的 test，計數器要自己擋
      await stubVisitorCounter(context);
      const page = await context.newPage();
      await gotoHome(page, undefined, fontSize);
      await page.getByLabel('隨機出題順序').uncheck();
      await startButton(page).click();
      await expect(page.locator('.question-card')).toBeVisible();
      await starInView(page);
      for (const way of ways) await toggleTwice(page, star(page), way, '.question-header');
      await context.close();
    });

    // 開始按鈕在首頁下方。從前換到題目頁時頁面還捲在那裡：Firefox 在題卡進場動畫途中選的 scroll anchor 是導覽列
    // （排在提示下面），一直用到下一次捲動，提示一插進來整頁往上捲，星號跑到頁首底下。現在換畫面時捲到最上面；
    // 這裡照使用者的操作走（不先捲），starInView 會先捲回最上面，看不到開始之後的捲動位置
    if (viewport.height >= 720) {
      for (const way of ['滑鼠', '觸控', 'Space'] as Way[]) {
        test(`題目頁 ${name}、開始之後沒有捲動過：${way}`, async ({ browser, baseURL }) => {
          const context = await browser.newContext({ baseURL, hasTouch: true, viewport });
          // 自己開的 context 沒有經過 fixtures.ts 的 test，計數器要自己擋
          await stubVisitorCounter(context);
          const page = await context.newPage();
          await gotoHome(page, undefined, fontSize);
          await page.getByLabel('隨機出題順序').uncheck();
          await startButton(page).click();
          await expect(page.locator('.question-card')).toBeVisible();
          await settleAnimations(page);
          const start = await starState(star(page));
          expect(start.scrollY, `換畫面時沒有捲到最上面 ${JSON.stringify(start)}`).toBe(0);
          expect(start.hitIsStar, `前提：星號在畫面上 ${JSON.stringify(start)}`).toBe(true);
          await toggleTwice(page, star(page), way, '.question-header');
          await context.close();
        });
      }
    }

    test(`結果頁的錯題卡、星號在視窗底部 ${name}：滑鼠、觸控、空白鍵、Enter`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({ baseURL, hasTouch: true, viewport });
      // 自己開的 context 沒有經過 fixtures.ts 的 test，計數器要自己擋
      await stubVisitorCounter(context);
      const page = await context.newPage();
      await toResultWithWrongCards(page, fontSize);
      const button = page.locator('.wrong-item').first().getByRole('button', { name: /加星號/ });
      await toViewportBottom(button);
      const start = await button.boundingBox();
      // 前提：結果頁夠高，星號捲得到視窗底部上方 20px（WebKit 與 Firefox 的捲動量有小數，差 1px 以內）
      expect(Math.abs(start!.y + start!.height - (viewport.height - 20)), `前提：星號在視窗底部上方 20px ${JSON.stringify(start)}`).toBeLessThanOrEqual(1.5);
      for (const way of ways) await toggleTwice(page, button, way, '.wrong-item:first-child .wrong-stem-row');
      await context.close();
    });
  }
});

// 提示收掉時它下面的東西往上移：別張卡的星號不能收掉它，不然排在它下面、剛按的那顆星號就從指標底下移走
test('結果頁 Pixel 7：第一張錯題卡的提示還在時按第二張的星號，第二張的星號不移動，提示留著', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, viewport: { width: 412, height: 839 } });
  // 自己開的 context 沒有經過 fixtures.ts 的 test，計數器要自己擋
  await stubVisitorCounter(context);
  const page = await context.newPage();
  await toResultWithWrongCards(page, 'normal');
  const cards = page.locator('.wrong-item');
  const first = cards.nth(0).getByRole('button', { name: /加星號/ });
  const second = cards.nth(1).getByRole('button', { name: /加星號/ });
  await first.click();
  await expect(cards.nth(0).locator('.wrong-stem-row + .review-notice')).toHaveText(TIP);
  await toViewportBottom(second);
  await settleAnimations(page);
  const before = await starState(second);
  await page.touchscreen.tap(before.x, before.y);
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  await settleAnimations(page);
  const after = await starState(second);
  expect(sameSpot(after), `第二張的星號移動了 ${JSON.stringify(after)}`).toEqual(sameSpot(before));
  await expect(cards.nth(0).locator('.wrong-stem-row + .review-notice')).toHaveText(TIP);
  await page.touchscreen.tap(before.x, before.y);
  await expect(second, '第二下點到的不是星號').toHaveAttribute('aria-pressed', 'false');
  await context.close();
});

test('螢幕閱讀器：開頁就有一個看不見的 live region，第一次加星號時它的字只換一次；看得到的提示不是 live region', async ({ page }) => {
  await gotoHome(page);
  const live = page.locator('.review-live');
  await expect(live).toHaveAttribute('role', 'status');
  await expect(live).toHaveAttribute('aria-live', 'polite');
  await expect(live).toBeEmpty();
  await live.evaluate((el) => {
    const w = window as unknown as { __said: string[]; __live: Element };
    w.__said = [];
    w.__live = el;
    new MutationObserver(() => w.__said.push(el.textContent ?? '')).observe(el, { childList: true, characterData: true, subtree: true });
  });
  await page.getByLabel('隨機出題順序').uncheck();
  await startButton(page).click();
  await star(page).click();
  await expect(page.locator('.review-notice')).toHaveText(TIP);
  await nextFrames(page);
  const result = await page.evaluate(() => {
    const w = window as unknown as { __said: string[]; __live: Element };
    const r = w.__live.getBoundingClientRect();
    return {
      said: w.__said,
      same: document.querySelector('.review-live') === w.__live,
      hidden: r.width <= 1 && r.height <= 1,
      shownIsLive: !!document.querySelector('.review-notice')!.closest('[aria-live], [role="status"], [role="alert"]'),
    };
  });
  expect(result.said).toEqual([TIP]);
  expect(result.same, '換了畫面，live region 被換成另一個元素').toBe(true);
  expect(result.hidden, 'live region 看得到').toBe(true);
  expect(result.shownIsLive, '看得到的提示自己是 live region').toBe(false);
});

/** 提示整個在頁首下面、視窗裡，排在文件流裡，字沒有被裁掉 */
const readable = (notice: Locator) =>
  notice.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const header = document.querySelector('.app-header')!.getBoundingClientRect();
    return {
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      headerBottom: Math.round(header.bottom),
      viewport: window.innerHeight,
      position: getComputedStyle(el).position,
      clipped: el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1,
    };
  });

function expectReadable(m: Awaited<ReturnType<typeof readable>>, what: string): void {
  const info = `${what} ${JSON.stringify(m)}`;
  expect(m.position, `不在文件流裡 ${info}`).toBe('static');
  expect(m.clipped, `字被裁掉 ${info}`).toBe(false);
  expect(m.top, `在頁首底下 ${info}`).toBeGreaterThanOrEqual(m.headerBottom);
  expect(m.bottom, `超出視窗 ${info}`).toBeLessThanOrEqual(m.viewport);
}

test.describe('320x256 字級特大（1280x1024 放大 400%）：說明看得到、整段讀得到', () => {
  test.use({ viewport: { width: 320, height: 256 } });

  test('新版資料：第一次畫出來就排在主內容最上面，不等開始操作才把內容往下推', async ({ page }) => {
    await page.addInitScript((key) => {
      window.localStorage.setItem(key, JSON.stringify({ v: 99, seeded: true, stars: {}, wrong: {} }));
    }, KEY);
    await recordFirstPaint(page);
    await gotoHome(page, undefined, 'xlarge');
    const notice = page.locator('#main-content > .review-notice');
    await expect(notice).toHaveText(/新版網站寫入的/);
    expect(await firstPaint(page), '說明不是第一次畫出來就在').toMatch(/新版網站寫入的/);
    expectReadable(await readable(notice), '新版資料的說明');
  });

  test('按星號存不進去：說明排在題卡標頭下面，捲到整段讀得到，星號還在畫面上', async ({ page }) => {
    await page.addInitScript((key) => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k: string, v: string) {
        if (k === key) throw new DOMException('quota', 'QuotaExceededError');
        set.call(this, k, v);
      };
    }, KEY);
    await gotoHome(page, undefined, 'xlarge');
    await page.getByLabel('隨機出題順序').uncheck();
    await startButton(page).click();
    await expect(page.locator('.question-card')).toBeVisible();
    await settleAnimations(page);
    await starInView(page);
    const before = await starState(star(page));
    expect(before.hitIsStar, `前提：星號在畫面上 ${JSON.stringify(before)}`).toBe(true);
    await page.mouse.click(before.x, before.y);
    const notice = page.locator('.question-header + .review-notice');
    await expect(notice).toHaveText('這次變更沒有儲存。瀏覽器可能封鎖了網站資料，或儲存空間已滿。');
    await expect(star(page)).toHaveAttribute('aria-pressed', 'false');
    // 沒有生效：捲到剛好看得到整段說明，不用使用者自己捲。星號跟著往上移，還在頁首下面
    await nextFrames(page);
    const m = await readable(notice);
    expectReadable(m, '存不進去的說明');
    const after = await starState(star(page));
    expect(after.top, `星號被捲到頁首底下 ${JSON.stringify(after)}`).toBeGreaterThanOrEqual(m.headerBottom);
  });
});

test('Pixel 7 字級特大：加星號之後換題、結束並返回首頁，都不留提示的空白', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 839 });
  await gotoHome(page, undefined, 'xlarge');
  await page.getByLabel('隨機出題順序').uncheck();
  await startButton(page).click();
  await star(page).click();
  await expect(page.locator('.question-header + .review-notice')).toHaveText(TIP);

  // 下一題的題卡：標頭下面直接是題幹
  await page.locator('.option-item').first().click();
  await page.getByRole('button', { name: /下一題/ }).click();
  await expect(progress(page)).toHaveText(/^2 \//);
  await expect(page.locator('.review-notice')).toHaveCount(0);

  await page.getByRole('button', { name: /結束並返回首頁/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: '結束並返回', exact: true }).click();
  await expect(page.getByRole('button', { name: /繼續測驗/ })).toBeVisible();
  await expect(page.locator('.review-notice')).toHaveCount(0);
  const gap = await page.evaluate(() => ({
    appPadding: getComputedStyle(document.querySelector('.app')!).paddingBottom,
    belowFooter:
      document.documentElement.scrollHeight - window.scrollY - document.querySelector('.app-footer')!.getBoundingClientRect().bottom,
  }));
  expect(gap.appPadding).toBe('0px');
  expect(Math.abs(gap.belowFooter), `頁尾下面留了空白 ${JSON.stringify(gap)}`).toBeLessThan(1);
});

// 按鈕的提示屬於那張題卡：換題就收掉。留著的話，按上一題回到那一題時舊的說明又出現，存不進去的還會捲過去，
// 把有焦點的上一題捲出視窗
for (const failing of [false, true]) {
  test(`按星號${failing ? '存不進去' : ''}之後換題，再按上一題回來：舊的提示不再出現，有焦點的上一題還在視窗裡`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 420 });
    await gotoHome(page);
    if (failing) await failWritesFrom(page, KEY);
    await page.getByLabel('隨機出題順序').uncheck();
    await startButton(page).click();
    await expect(page.locator('.question-card')).toBeVisible();
    await page.locator('.option-item').first().click();
    await page.getByRole('button', { name: /下一題/ }).click();
    await expect(progress(page)).toHaveText(/^2 \//);
    await star(page).click();
    await expect(page.locator('.question-header + .review-notice')).toHaveText(failing ? NOT_SAVED : TIP);
    await page.locator('.option-item').first().click();
    await page.getByRole('button', { name: /下一題/ }).click();
    await expect(progress(page)).toHaveText(/^3 \//);
    await expect(page.locator('.review-notice')).toHaveCount(0);
    const prev = page.getByRole('button', { name: /上一題/ });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await nextFrames(page);
    await prev.focus();
    await page.keyboard.press('Enter');
    await expect(progress(page)).toHaveText(/^2 \//);
    await settleAnimations(page);
    await nextFrames(page);
    const m = await prev.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const header = document.querySelector('.app-header')!.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, headerBottom: header.bottom, viewport: window.innerHeight };
    });
    const info = JSON.stringify(m);
    expect(m.bottom, `上一題被捲出視窗 ${info}`).toBeLessThanOrEqual(m.viewport);
    expect(m.top, `上一題被捲到頁首底下 ${info}`).toBeGreaterThanOrEqual(m.headerBottom);
    await expect(prev).toBeFocused();
    await expect(page.locator('.review-notice')).toHaveCount(0);
  });
}

/** 有焦點的元素沒有被頁首或星號的提示蓋住（WCAG 2.4.11）：與兩者都不重疊，也在視窗裡 */
async function expectNotCovered(target: Locator, where: string): Promise<void> {
  const m = await target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const header = document.querySelector('.app-header')!.getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      headerBottom: header.bottom,
      notices: [...document.querySelectorAll('.review-notice')].map((n) => {
        const b = n.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom };
      }),
      viewport: window.innerHeight,
    };
  });
  const info = `${where} ${JSON.stringify(m)}`;
  expect(m.top, `被頁首蓋住 ${info}`).toBeGreaterThanOrEqual(m.headerBottom);
  expect(m.notices.some((n) => m.top < n.bottom && m.bottom > n.top), `被提示蓋住 ${info}`).toBe(false);
  expect(m.bottom, `在視窗外 ${info}`).toBeLessThanOrEqual(m.viewport);
}

test.describe('加星號之後用鍵盤作答、下一題：焦點不被頁首或提示蓋住，下一題的題幹在頁首下面（WCAG 2.4.11）', () => {
  for (const { name, viewport } of [
    { name: '桌面', viewport: { width: 1280, height: 720 } },
    { name: 'Pixel 7 的大小', viewport: { width: 412, height: 839 } },
  ]) {
    for (const fontSize of ['normal', 'large', 'xlarge'] as const) {
      test(`${name}、字級 ${fontSize}：走過每一個選項、作答、下一題`, async ({ browser, baseURL }) => {
        const context = await browser.newContext({ baseURL, viewport });
        // 自己開的 context 沒有經過 fixtures.ts 的 test，計數器要自己擋
        await stubVisitorCounter(context);
        const page = await context.newPage();
        await gotoHome(page, undefined, fontSize);
        await page.getByLabel('隨機出題順序').uncheck();
        await startButton(page).click();
        await expect(page.locator('.question-card')).toBeVisible();
        await star(page).click();
        await expect(page.locator('.review-notice')).toHaveText(TIP);

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

/**
 * 從頁尾往回按 Shift+Tab 到頁首，每一個拿到焦點的元素都不被頁首整個蓋住（WCAG 2.4.11）；
 * 放得下的要整個露出來。頁首是 sticky，捲到焦點的地方要停在它下面（html 的 scroll-padding-top）。
 */
async function shiftTabFromFooter(page: Page): Promise<string[]> {
  await settleAnimations(page);
  await page.locator('.app-footer a').last().focus();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const problems: string[] = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Shift+Tab');
    // Header.tsx 在焦點移動後的下一個 frame 才補捲（Firefox），等兩個 frame 再量
    await nextFrames(page);
    const m = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      if (el.closest('.app-header') || el.matches('.skip-link')) return { stop: true as const };
      let t: Element = el.closest('.option-item') ?? el;
      if (t.getBoundingClientRect().height < 2) t = el.closest('label') ?? el.parentElement ?? el;
      const r = t.getBoundingClientRect();
      const header = document.querySelector('.app-header')!.getBoundingClientRect();
      return {
        stop: false as const,
        name: (el.getAttribute('aria-label') || t.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 20),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        freeTop: Math.round(Math.max(header.bottom, 0)),
        freeBottom: window.innerHeight,
      };
    });
    if (!m) continue;
    if (m.stop) return problems;
    const visible = Math.min(m.bottom, m.freeBottom) - Math.max(m.top, m.freeTop);
    const fits = m.bottom - m.top <= m.freeBottom - m.freeTop;
    const ok = fits ? m.top >= m.freeTop - 1 && m.bottom <= m.freeBottom + 1 : visible > 0;
    if (!ok) problems.push(JSON.stringify(m));
  }
  throw new Error('按了 60 次 Shift+Tab 還沒回到頁首');
}

test.describe('用 Shift+Tab 往回走，焦點不被 sticky 頁首蓋住（WCAG 2.4.11）', () => {
  for (const { viewport, fontSize } of [
    { viewport: { width: 412, height: 839 }, fontSize: 'xlarge' as const },
    { viewport: { width: 1280, height: 720 }, fontSize: 'large' as const },
    { viewport: { width: 390, height: 400 }, fontSize: 'normal' as const },
    { viewport: { width: 320, height: 256 }, fontSize: 'normal' as const },
  ]) {
    const size = `${viewport.width}x${viewport.height} 字級 ${fontSize}`;
    test(`題目頁加星號之後 ${size}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await gotoHome(page, undefined, fontSize);
      await page.getByLabel('隨機出題順序').uncheck();
      await startButton(page).click();
      await star(page).click();
      await expect(page.locator('.review-notice')).toHaveText(TIP);
      expect(await shiftTabFromFooter(page)).toEqual([]);
    });

    test(`設定頁有提示時 ${size}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((key) => {
        window.localStorage.setItem(key, JSON.stringify({ v: 99, seeded: true, stars: {}, wrong: {} }));
      }, KEY);
      await gotoHome(page, undefined, fontSize);
      await page.getByRole('button', { name: '開啟設定' }).click();
      await expect(page.locator('.review-notice')).toHaveText(/新版網站/);
      expect(await shiftTabFromFooter(page)).toEqual([]);
    });
  }
});

// 第一次造訪的加強練習池對話框是 role="dialog" 的 div，不是 <dialog>。在裡面用鍵盤移動焦點時，Header.tsx 的補捲不能對
// 它裡面的元素呼叫 scrollIntoView：對話框自己捲動，html 的 scroll-padding-top 跟它無關，捲了反而把對話框的內容移走
test.describe('對話框裡用鍵盤移動焦點：頁首的補捲不碰對話框裡的元素', () => {
  for (const { viewport, fontSize } of [
    { viewport: { width: 341, height: 192 }, fontSize: 'xlarge' as const },
    { viewport: { width: 320, height: 256 }, fontSize: 'xlarge' as const },
    { viewport: { width: 320, height: 256 }, fontSize: 'normal' as const },
  ]) {
    test(`加強練習池的對話框 ${viewport.width}x${viewport.height} 字級 ${fontSize}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((size) => {
        window.localStorage.setItem('ipas-quiz-a11y', JSON.stringify({ fontSize: size }));
        const calls: string[] = [];
        (window as unknown as { __dialogScrolls: string[] }).__dialogScrolls = calls;
        const original = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) {
          if (this.closest('[role="dialog"], [aria-modal="true"], dialog')) {
            calls.push(`${this.tagName}.${this.className} ${(this.textContent ?? '').trim().slice(0, 12)}`);
          }
          return original.call(this, arg);
        };
      }, fontSize);
      await page.goto('/');
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('button', { name: '暫不啟用' })).toBeVisible();
      for (const key of ['Shift+Tab', 'Shift+Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab']) {
        await page.keyboard.press(key);
        await nextFrames(page);
        // 前提：焦點一直在對話框裡（Tab 出不去）
        expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), `${key} 之後焦點不在對話框裡`).toBe(true);
      }
      expect(await page.evaluate(() => (window as unknown as { __dialogScrolls: string[] }).__dialogScrolls)).toEqual([]);
    });
  }
});

/** live region 從現在起每一次變動之後的字（init script 之外另外裝） */
const recordLive = (page: Page) =>
  page.locator('.review-live').evaluate((el) => {
    const w = window as unknown as { __said: string[] };
    w.__said = [];
    new MutationObserver(() => w.__said.push(el.textContent ?? '')).observe(el, { childList: true, characterData: true, subtree: true });
  });
const liveSaid = (page: Page) => page.evaluate(() => (window as unknown as { __said: string[] }).__said.slice());

/** 這個分頁之後的 setItem 寫這支 key 都丟例外（儲存空間滿了） */
const failWritesFrom = (page: Page, prefix: string) =>
  page.evaluate((p) => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k.startsWith(p)) throw new DOMException('quota', 'QuotaExceededError');
      set.call(this, k, v);
    };
  }, prefix);

test('設定頁清除星號存不進去：只在設定頁自己的狀態列說，不加星號的提示、不從 live region 再念一次', async ({ page }) => {
  await gotoHome(page, { stars: [idOf(q1)] });
  await page.getByRole('button', { name: '開啟設定' }).click();
  const clear = page.getByRole('button', { name: '清除星號' });
  await clear.scrollIntoViewIfNeeded();
  await settleAnimations(page);
  await recordLive(page);
  await failWritesFrom(page, KEY);
  const before = await clear.evaluate((el) => ({ top: el.getBoundingClientRect().top, scrollY: window.scrollY }));
  await clear.click();
  await page.getByRole('button', { name: '確定清除' }).click();
  await expect(page.locator('.review-backup__status')).toHaveText(/^沒有清除/);
  await nextFrames(page);
  await nextFrames(page);
  await expect.soft(page.locator('.review-notice'), '加了星號的提示').toHaveCount(0);
  expect.soft(await liveSaid(page), 'live region 又念了一次').toEqual([]);
  expect(await clear.evaluate((el) => ({ top: el.getBoundingClientRect().top, scrollY: window.scrollY }))).toEqual(before);
});

const NOT_SAVED = '這次變更沒有儲存。瀏覽器可能封鎖了網站資料，或儲存空間已滿。';
const END_RESOLVED = '已經讀到另一個分頁的變更，星號與待複習紀錄又能儲存了。';

test.describe('螢幕閱讀器：每一次的提示都念，看得到的提示收掉時 live region 也清空', () => {
  test('題目頁存不進去兩次，一樣的字：念兩次；同一顆再按一次也念；換題時清空', async ({ page }) => {
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
    await expect(page.locator('.question-card')).toBeVisible();
    await recordLive(page);
    const live = page.locator('.review-live');

    await star(page).click();
    await expect(page.locator('.question-header + .review-notice')).toHaveText(NOT_SAVED);
    await expect(live).toHaveText(NOT_SAVED);

    await page.locator('.option-item').first().click();
    await page.getByRole('button', { name: /下一題/ }).click();
    await expect(progress(page)).toHaveText(/^2 \//);
    await expect(page.locator('.review-notice')).toHaveCount(0);
    await expect.soft(live, '看得到的提示收掉了，live region 還留著那一句').toBeEmpty();

    await star(page).click();
    await expect(page.locator('.question-header + .review-notice')).toHaveText(NOT_SAVED);
    await expect.poll(async () => (await liveSaid(page)).filter((t) => t === NOT_SAVED).length, '第二題的同一句沒有念').toBe(2);

    await star(page).click();
    await expect.poll(async () => (await liveSaid(page)).filter((t) => t === NOT_SAVED).length, '同一顆再按一次沒有念').toBe(3);
    await expect(live).toHaveText(NOT_SAVED);
  });
});

// 頁面的說明只有換畫面時就知道的才排在主內容最上面。按按鈕才發現的（新版資料、搬不走的壞資料）排在那顆按鈕下面；
// 沒有人按、別的分頁造成的（storage 事件）排在主內容最後面。兩種都不推動使用者正在看的東西上面的內容
test.describe('之後才出現的說明不排在主內容最上面：上面的東西不動', () => {
  for (const { name, text, newer } of [
    { name: '別的分頁寫了新版資料、這個分頁沒收到 storage 事件', text: /新版網站寫入的/, newer: true },
    { name: '別的分頁寫了讀不懂的資料、這個分頁搬不走', text: /不會儲存變更/, newer: false },
  ]) {
    test(`${name}：按星號時說明排在題卡標頭下面，星號不移動`, async ({ page, context }) => {
      // 背景分頁被瀏覽器凍結時收不到 storage 事件
      if (newer) await page.addInitScript(() => window.addEventListener('storage', (e) => e.stopImmediatePropagation(), true));
      await gotoHome(page);
      await page.getByLabel('隨機出題順序').uncheck();
      await startButton(page).click();
      await expect(page.locator('.question-card')).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      await settleAnimations(page);
      const other = await context.newPage();
      await other.goto('/');
      if (newer) {
        await other.evaluate((key) => window.localStorage.setItem(key, JSON.stringify({ v: 2, seeded: true, stars: {}, wrong: {} })), KEY);
      } else {
        await other.evaluate((key) => window.localStorage.setItem(key, '{broken'), KEY);
        await failWritesFrom(page, `${KEY}:corrupt`);
      }
      await other.close();
      await nextFrames(page);
      const before = await starState(star(page));
      await page.mouse.click(before.x, before.y);
      await expect(page.locator('.review-notice', { hasText: text })).toBeVisible();
      await nextFrames(page);
      const after = await starState(star(page));
      const info = JSON.stringify(after);
      expect(sameSpot(after), `星號移動了 ${info}`).toEqual(sameSpot(before));
      expect(after.hitIsStar, `點同一個位置點到的不是星號 ${info}`).toBe(true);
      await expect(page.locator('.question-header + .review-notice')).toHaveText(text);
      await expect(page.locator('.review-notice')).toHaveCount(1);
      await expect(star(page)).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('.review-live')).toHaveText(text);
    });
  }

  test('別的分頁寫了新版資料、這個分頁什麼都沒按：說明排在主內容最後面，收掉時上面也不動', async ({ page, context }) => {
    await gotoHome(page);
    await page.getByLabel('隨機出題順序').uncheck();
    await startButton(page).click();
    await expect(page.locator('.question-card')).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await settleAnimations(page);
    const before = await starState(star(page));
    const other = await context.newPage();
    await other.goto('/');
    await other.evaluate((key) => window.localStorage.setItem(key, JSON.stringify({ v: 2, seeded: true, stars: {}, wrong: {} })), KEY);
    const notice = page.locator('.review-notice', { hasText: /新版網站寫入的/ });
    await expect(notice).toHaveCount(1);
    await nextFrames(page);
    const after = await starState(star(page));
    expect(sameSpot(after), `星號移動了 ${JSON.stringify(after)}`).toEqual(sameSpot(before));
    // 在主內容最後面：頁面自己的內容之後、頁尾之前
    const where = await notice.evaluate((el) => {
      const main = document.getElementById('main-content')!;
      const content = main.querySelector('.quiz-page')!.getBoundingClientRect();
      const footer = document.querySelector('.app-footer')!.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return { last: main.lastElementChild === el, top: r.top, bottom: r.bottom, contentBottom: content.bottom, footerTop: footer.top };
    });
    const info = JSON.stringify(where);
    expect(where.last, `不是主內容的最後一個 ${info}`).toBe(true);
    expect(where.top, `在頁面內容之前 ${info}`).toBeGreaterThanOrEqual(where.contentBottom - 0.5);
    expect(where.bottom, `在頁尾之後 ${info}`).toBeLessThanOrEqual(where.footerTop + 0.5);
    await expect(page.locator('.review-live')).toHaveText(/新版網站寫入的/);

    // 別的分頁把資料改回讀得懂的：不收掉，改說已經恢復，上面一樣不動，live region 念恢復的那一句
    await other.evaluate((key) => window.localStorage.setItem(key, JSON.stringify({ v: 1, seeded: true, stars: {}, wrong: {} })), KEY);
    await expect(notice).toHaveCount(0);
    await expect(page.locator('.review-notice--end')).toHaveText(END_RESOLVED);
    await nextFrames(page);
    expect(sameSpot(await starState(star(page))), '改說已經恢復之後星號移動了').toEqual(sameSpot(before));
    await expect(page.locator('.review-live')).toHaveText(END_RESOLVED);
  });

  // 最後面那一段收掉或變矮時，捲到最底的頁面跟著變短，瀏覽器把捲動位置往上拉，上面的東西全部往下移
  test('結果頁捲到最底：別的分頁寫了新版資料又改回來，最後面那一段不變矮，再測一次不移動', async ({ page, context }) => {
    // 這個寬度新版資料的說明折成兩行，恢復的那一句一行
    await page.setViewportSize({ width: 600, height: 700 });
    const qs = [q1, q2, q3];
    const wrong = Object.fromEntries(qs.map((q) => [idOf(q), { streak: 0, last: 1 }]));
    await toResultWithWrongCards(page, 'normal');
    const other = await context.newPage();
    await other.goto('/');
    const write = (v: number) =>
      other.evaluate(
        ({ key, raw }) => window.localStorage.setItem(key, raw),
        { key: KEY, raw: JSON.stringify({ v, seeded: true, stars: {}, wrong }) }
      );
    await write(2);
    await expect(page.locator('.review-notice--end')).toHaveText(/新版網站寫入的/);
    const measureEnd = () =>
      page.locator('.review-notice--end').evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return { box: el.getBoundingClientRect().height, text: range.getBoundingClientRect().height };
      });
    const tall = await measureEnd();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await nextFrames(page);
    const retry = page.getByRole('button', { name: /再測一次/ });
    const spot = () =>
      retry.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { top: r.top, scrollY: window.scrollY, hit: hit !== null && el.contains(hit) };
      });
    const before = await spot();
    await write(1);
    await expect(page.locator('.review-notice', { hasText: /新版網站寫入的/ })).toHaveCount(0);
    await nextFrames(page);
    const after = await spot();
    expect(after, `再測一次移動了 ${JSON.stringify({ before, after })}`).toEqual(before);
    await expect(page.locator('.review-notice--end')).toHaveText(END_RESOLVED);
    const short = await measureEnd();
    const sizes = JSON.stringify({ tall, short });
    // 前提：恢復的那一句至少少一行，不然這個測試量不到變矮
    expect(short.text, `前提：恢復的那一句比較矮 ${sizes}`).toBeLessThan(tall.text - 10);
    expect(short.box, `最後面那一段變矮了 ${sizes}`).toBeGreaterThanOrEqual(tall.box - 0.5);
    // 換畫面就拿掉
    await page.getByRole('button', { name: /回首頁/ }).first().click();
    await expect(page.locator('.review-notice')).toHaveCount(0);
  });

  test('設定頁捲到最底、最後面有別的分頁造成的說明：清除星號之後，清除星號那顆按鈕不移動', async ({ page, context }) => {
    await gotoHome(page, { stars: [idOf(q1)] });
    await page.getByRole('button', { name: '開啟設定' }).click();
    const clear = page.getByRole('button', { name: '清除星號' });
    await expect(clear).toBeVisible();
    const other = await context.newPage();
    await other.goto('/');
    await other.evaluate((key) => window.localStorage.setItem(key, JSON.stringify({ v: 2, seeded: true, stars: {}, wrong: {} })), KEY);
    await expect(page.locator('.review-notice--end')).toHaveText(/新版網站寫入的/);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await nextFrames(page);
    const spot = () => clear.evaluate((el) => ({ top: el.getBoundingClientRect().top, scrollY: window.scrollY }));
    const before = await spot();
    await clear.click();
    await page.getByRole('button', { name: '確定清除' }).click();
    await expect(page.locator('.review-backup__status')).toHaveText(/新版網站寫入的/);
    await nextFrames(page);
    const after = await spot();
    expect(after, `清除星號移動了 ${JSON.stringify({ before, after })}`).toEqual(before);
    await expect(page.locator('.review-notice--end')).toHaveText(/新版網站寫入的/);
  });
});

// 結果頁的星號在視窗底部時，排在它下面的提示在視窗外。第一次加星號的提示要真的看到過才算看過；
// 存不進去的說明一定要看得到：捲到剛好看得到（toggle 沒有生效，頁面動了也不會點錯），焦點不動
test.describe('星號在視窗底部：提示在視窗外時', () => {
  for (const { name, viewport, fontSize } of toggleViewports) {
    test(`第一次加星號 ${name}：頁面不捲，提示沒看到就不算看過，下次再出現`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({ baseURL, viewport });
      // 自己開的 context 沒有經過 fixtures.ts 的 test，計數器要自己擋
      await stubVisitorCounter(context);
      const page = await context.newPage();
      await toResultWithWrongCards(page, fontSize);
      const button = page.locator('.wrong-item').first().getByRole('button', { name: /加星號/ });
      await toViewportBottom(button);
      await settleAnimations(page);
      const before = await starState(button);
      await page.mouse.click(before.x, before.y);
      const tip = page.locator('.wrong-item:first-child .wrong-stem-row + .review-notice');
      await expect(tip).toHaveText(TIP);
      await nextFrames(page);
      await nextFrames(page);
      expect(sameSpot(await starState(button)), '星號移動了').toEqual(sameSpot(before));
      const seen = () => page.evaluate(() => window.localStorage.getItem('ipas-review-star-hint-seen'));
      expect(await seen(), '提示大半在視窗外，卻算看過了').toBeNull();

      // 取消再加：還沒看過，提示再出現一次
      await page.mouse.click(before.x, before.y);
      await expect(button).toHaveAttribute('aria-pressed', 'false');
      await page.mouse.click(before.x, before.y);
      await expect(tip).toHaveText(TIP);

      // 捲過去看到了，才算看過
      await tip.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await expect.poll(seen).toBe('1');
      await context.close();
    });

    for (const way of ['滑鼠', 'Space'] as const) {
      test(`存不進去 ${name}、${way}：捲到看得到說明，星號不捲到頁首底下，焦點不動`, async ({ browser, baseURL }) => {
        const context = await browser.newContext({ baseURL, viewport });
        // 自己開的 context 沒有經過 fixtures.ts 的 test，計數器要自己擋
        await stubVisitorCounter(context);
        const page = await context.newPage();
        await toResultWithWrongCards(page, fontSize);
        const button = page.locator('.wrong-item').first().getByRole('button', { name: /加星號/ });
        if (way === 'Space') await button.focus();
        await toViewportBottom(button);
        await settleAnimations(page);
        await failWritesFrom(page, KEY);
        const before = await starState(button);
        if (way === 'Space') await page.keyboard.press('Space');
        else await page.mouse.click(before.x, before.y);
        const notice = page.locator('.wrong-item:first-child .wrong-stem-row + .review-notice');
        await expect(notice).toHaveText(NOT_SAVED);
        await expect(button).toHaveAttribute('aria-pressed', 'false');
        await nextFrames(page);
        const m = await readable(notice);
        const starTop = (await starState(button)).top;
        const info = JSON.stringify({ ...m, starTop });
        // 剛按的星號不捲到頁首底下（焦點看得到優先）
        expect(starTop, `星號被捲到頁首底下 ${info}`).toBeGreaterThanOrEqual(m.headerBottom - 1);
        if (m.bottom - starTop <= m.viewport - m.headerBottom) {
          // 放得下：整段看得到，只捲需要的，說明的底邊貼著視窗底邊
          expectReadable(m, '存不進去的說明');
          expect(Math.abs(m.bottom - m.viewport), `捲過頭了 ${info}`).toBeLessThanOrEqual(1);
        } else {
          // 放不下（320x256 字級特大，題幹那一列比視窗高）：捲到星號停在頁首下緣為止，說明露出放得下的部分
          // （Firefox 的字比較寬，那一列更高，說明可能一點都露不出來）
          expect(starTop - m.headerBottom, `沒有捲到星號停在頁首下緣 ${info}`).toBeLessThanOrEqual(1);
        }
        if (way === 'Space') await expect(button).toBeFocused();
        else expect(await page.evaluate(() => document.activeElement?.closest('.review-notice'))).toBeNull();
        await context.close();
      });
    }
  }
});

// 再測一次沒有題目的說明與按鈕引起的提示同一套：排在按鈕那一列下面，按鈕不動；每按一次都念，字一樣也念
test('結果頁名單空了再測一次：說明排在按鈕那一列下面，再測一次不移動；按兩次念兩次', async ({ page }) => {
  await gotoHome(page, { wrong: { [idOf(q1)]: { streak: 0, last: 1 } } });
  await startDrill(page, 'review:wrong');
  await answer(page, q1, false);
  await page.getByRole('button', { name: '移出待複習' }).click();
  await expect(page.getByText('已移出待複習')).toBeVisible();
  await page.getByRole('button', { name: /完成測驗/ }).click();
  const again = page.getByRole('button', { name: /再測一次/ });
  await again.scrollIntoViewIfNeeded();
  await settleAnimations(page);
  await recordLive(page);
  const spot = () =>
    again.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { top: r.top, scrollY: window.scrollY, hit: hit !== null && el.contains(hit), x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
  const before = await spot();
  const EMPTY = '目前沒有待複習錯題可以再測一次，回首頁可以選其他題目來源。';
  await page.mouse.click(before.x, before.y);
  const notice = page.locator('.action-section + .action-notice');
  await expect(notice).toHaveText(EMPTY);
  await nextFrames(page);
  const after = await spot();
  expect(after, `再測一次移動了 ${JSON.stringify({ before, after })}`).toEqual(before);
  await expect.poll(() => liveSaid(page)).toEqual([EMPTY]);
  await page.mouse.click(before.x, before.y);
  await expect.poll(() => liveSaid(page)).toEqual([EMPTY, '', EMPTY]);
  await expect(page.locator('.action-notice')).toHaveCount(1);
  expect(await spot()).toEqual(before);
});

// 別的分頁改了名單：畫面上的一段跟著換字，但不消失、不變矮，下面的東西才不會往上移到使用者正要按的地方
test.describe('別的分頁改了名單：下面的按鈕不移動', () => {
  test('結果頁：別的分頁清掉待複習錯題，移出那幾列留著、改說已經不在清單上，第三張卡的星號不動', async ({ page, context }) => {
    await toResultWithWrongCards(page, 'normal');
    const third = page.locator('.wrong-item').nth(2).getByRole('button', { name: /加星號/ });
    await third.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await nextFrames(page);
    const before = await starState(third);
    const other = await context.newPage();
    await other.goto('/');
    await other.evaluate((key) => window.localStorage.setItem(key, JSON.stringify({ v: 1, seeded: true, stars: {}, wrong: {} })), KEY);
    await expect(page.getByRole('button', { name: /移出待複習/ })).toHaveCount(0);
    await nextFrames(page);
    const after = await starState(third);
    expect(sameSpot(after), `第三張卡的星號移動了 ${JSON.stringify({ before, after })}`).toEqual(sameSpot(before));
    await expect(page.locator('.review-remove', { hasText: '已不在待複習清單上' })).toHaveCount(3);
    await expect(page.locator('.wrong-review-hint')).toHaveText('這幾題都已不在待複習清單上。');
  });

  test('首頁：選了星號題、別的分頁清掉星號，題數說明換字但不變矮，開始測驗不動', async ({ page, context }) => {
    await gotoHome(page, { stars: [q1, q2, q3].map(idOf) });
    await source(page).selectOption('review:starred');
    await page.locator('#count').fill('10');
    await page.locator('#count').blur();
    await expect(page.locator('#source-hint')).toContainText('本次會出 3 題');
    await startButton(page).scrollIntoViewIfNeeded();
    await nextFrames(page);
    const spot = () => startButton(page).evaluate((el) => ({ top: el.getBoundingClientRect().top, scrollY: window.scrollY }));
    const before = await spot();
    const other = await context.newPage();
    await other.goto('/');
    await other.evaluate((key) => window.localStorage.setItem(key, JSON.stringify({ v: 1, seeded: true, stars: {}, wrong: {} })), KEY);
    await expect(page.locator('#source-hint')).toHaveText(/還沒有星號題/);
    await nextFrames(page);
    expect(await spot(), '開始測驗移動了').toEqual(before);
  });
});

// 換畫面時從最上面開始。之前捲動位置留著：新畫面比較短時被夾在最底，Chromium 的 scroll anchoring 還記著舊畫面的位置，
// 之後頁面一變長（別的分頁的說明排到最後面）就捲回去，整頁往上移：開始測驗之後選項 B 往上 54，點下去選到 C
test.describe('換畫面時從最上面開始：別的分頁的說明排到最後面時，畫面上的東西不動', () => {
  /** 下一次主內容換掉之後、畫出來之前的捲動位置（MutationObserver 之後的第一個 requestAnimationFrame） */
  const watchSwap = (page: Page, selector: string) =>
    page.evaluate((selector) => {
      const w = window as unknown as { __swapScrollY?: number };
      delete w.__swapScrollY;
      const main = document.getElementById('main-content')!;
      const observer = new MutationObserver(() => {
        if (!main.querySelector(selector)) return;
        observer.disconnect();
        requestAnimationFrame(() => {
          w.__swapScrollY = window.scrollY;
        });
      });
      observer.observe(main, { childList: true, subtree: true });
    }, selector);
  const swapScrollY = (page: Page) =>
    page.waitForFunction(() => (window as unknown as { __swapScrollY?: number }).__swapScrollY !== undefined).then(() =>
      page.evaluate(() => (window as unknown as { __swapScrollY?: number }).__swapScrollY)
    );
  const writeNewer = async ({ page, context }: { page: Page; context: BrowserContext }) => {
    const other = await context.newPage();
    await other.goto('/');
    await other.evaluate((key) => window.localStorage.setItem(key, JSON.stringify({ v: 2, seeded: true, stars: {}, wrong: {} })), KEY);
    await other.close();
    await expect(page.locator('.review-notice--end')).toHaveCount(1);
    await nextFrames(page);
  };
  const spot = (target: Locator) =>
    target.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, scrollY: window.scrollY, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });

  test('開始測驗（開始按鈕在首頁下方）：題目頁第一次畫出來就在最上面；之後別的分頁寫了新版資料，選項 B 不動，點同一個位置選到 B', async ({ page, context }) => {
    await gotoHome(page);
    await page.getByLabel('測驗模式').selectOption('exam');
    await page.getByLabel('隨機出題順序').uncheck();
    await startButton(page).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => window.scrollY), '前提：開始按鈕在首頁下方').toBeGreaterThan(100);
    await watchSwap(page, '.question-card');
    await startButton(page).click();
    expect.soft(await swapScrollY(page), '題目頁第一次畫出來時不在最上面').toBe(0);
    await settleAnimations(page);
    const optionB = page.getByTestId('option-B');
    const before = await spot(optionB);
    await writeNewer({ page, context });
    expect(await spot(optionB), '選項 B 移動了').toEqual(before);
    await page.mouse.click(before.x, before.y);
    await expect(page.getByRole('radio', { name: /^B:/ })).toBeChecked();
  });

  test('結果頁捲到最底按回首頁：首頁第一次畫出來就在最上面；之後別的分頁寫了新版資料，開始測驗不動', async ({ page, context }) => {
    await toResultWithWrongCards(page, 'normal');
    const home = page.locator('.action-section').getByRole('button', { name: /首頁/ });
    await home.scrollIntoViewIfNeeded();
    await watchSwap(page, '.home-page');
    await home.click();
    expect.soft(await swapScrollY(page), '首頁第一次畫出來時不在最上面').toBe(0);
    await settleAnimations(page);
    await startButton(page).scrollIntoViewIfNeeded();
    await nextFrames(page);
    const before = await spot(startButton(page));
    await writeNewer({ page, context });
    expect(await spot(startButton(page)), '開始測驗移動了').toEqual(before);
  });

  test('Pixel 7 橫向點開始測驗：星號在視窗裡、在頁首下面', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, hasTouch: true, viewport: { width: 839, height: 412 } });
    await stubVisitorCounter(context);
    const page = await context.newPage();
    await gotoHome(page);
    await page.getByLabel('隨機出題順序').uncheck();
    await startButton(page).tap();
    await expect(page.locator('.question-card')).toBeVisible();
    await settleAnimations(page);
    const where = await star(page).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, header: document.querySelector('header')!.getBoundingClientRect().bottom, scrollY: window.scrollY };
    });
    const info = JSON.stringify(where);
    expect(where.top, `星號在頁首底下 ${info}`).toBeGreaterThanOrEqual(where.header);
    expect(where.bottom, `星號在視窗下面 ${info}`).toBeLessThanOrEqual(412);
    await context.close();
  });
});

// 移出待複習那一列：有沒有這一列在畫出來時就定了，之後名單變了只在同一個元素裡換字，高度留在最高的時候，
// 焦點留在那一列（Discussion #1）
test.describe('移出待複習那一列：別的分頁改了名單，下面的東西不動，焦點不掉回 body', () => {
  const writeWrong = async ({ context }: { context: BrowserContext }, ids: string[]) => {
    const other = await context.newPage();
    await other.goto('/');
    const raw = JSON.stringify({ v: 1, seeded: true, stars: {}, wrong: Object.fromEntries(ids.map((id) => [id, { streak: 0, last: 2 }])) });
    await other.evaluate(({ key, raw }) => window.localStorage.setItem(key, raw), { key: KEY, raw });
    await other.close();
  };
  const spot = (target: Locator) =>
    target.evaluate((el) => ({ top: el.getBoundingClientRect().top, scrollY: window.scrollY }));
  const active = (page: Page) =>
    page.evaluate(() => {
      const el = document.activeElement!;
      return `${el.tagName}${el.closest('.review-remove') ? ' in row' : ''}:${(el.textContent ?? '').trim()}`;
    });

  test('結果頁：用鍵盤移出第一題，別的分頁加回來又移出：第二張卡不動，焦點跟著那一列換上來的按鈕與字', async ({ page, context }) => {
    await toResultWithWrongCards(page, 'normal');
    const first = page.locator('.wrong-item').first();
    const remove = first.getByRole('button', { name: /移出待複習/ });
    await remove.focus();
    await page.keyboard.press('Enter');
    await expect(first.getByText('已移出待複習')).toBeFocused();
    // 第一張卡的那一列在視窗上半，第二張卡在它下面
    await first.getByText('已移出待複習').evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 200));
    await nextFrames(page);
    const second = page.locator('.wrong-item').nth(1);
    const before = await spot(second);
    await writeWrong({ context }, [q1, q2, q3].map(idOf));
    await expect(remove).toHaveCount(1);
    await nextFrames(page);
    expect(await spot(second), '加回來之後第二張卡移動了').toEqual(before);
    expect(await active(page), '加回來之後焦點不在那一列的按鈕上').toBe('BUTTON in row:移出待複習');
    await writeWrong({ context }, [q2, q3].map(idOf));
    await expect(remove).toHaveCount(0);
    await nextFrames(page);
    expect(await spot(second), '又移出之後第二張卡移動了').toEqual(before);
    expect(await active(page), '又移出之後焦點不在那一列').toBe('P in row:已移出待複習');
  });

  test('題目頁練習模式：答完之後別的分頁把這一題移出又加回來：那一列留著換字，下一題不動', async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoHome(page, { wrong: Object.fromEntries([q1, q2, q3].map((q) => [idOf(q), { streak: 0, last: 1 }])) });
    await startDrill(page, 'review:wrong');
    const text = await stem(page).textContent();
    const current = [q1, q2, q3].find((x) => x.stem === text)!;
    await answer(page, current, false);
    const row = page.locator('.question-card .review-remove');
    await expect(row.getByRole('button', { name: '移出待複習' })).toBeVisible();
    const next = page.getByRole('button', { name: /下一題/ });
    await row.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 150));
    await settleAnimations(page);
    const before = await spot(next);
    await writeWrong({ context }, [q1, q2, q3].filter((x) => x !== current).map(idOf));
    await expect(row).toHaveText('已不在待複習清單上');
    await nextFrames(page);
    expect(await spot(next), '移出之後下一題移動了').toEqual(before);
    await writeWrong({ context }, [q1, q2, q3].map(idOf));
    await expect(row.getByRole('button', { name: '移出待複習' })).toBeVisible();
    await nextFrames(page);
    expect(await spot(next), '加回來之後下一題移動了').toEqual(before);
  });

  test('題目頁練習模式：答完的題目不在名單上，別的分頁把它加進來：這一題不加一列，下一題不動；換題之後照名單畫', async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoHome(page);
    await page.getByLabel('隨機出題順序').uncheck();
    await startButton(page).click();
    await expect(page.locator('.question-card')).toBeVisible();
    const text = await stem(page).textContent();
    const current = bank.find((x) => x.stem === text)!;
    await answer(page, current, false);
    const next = page.getByRole('button', { name: /下一題/ });
    await page.locator('.question-options').evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().bottom - 200));
    await settleAnimations(page);
    const before = await spot(next);
    await writeWrong({ context }, [idOf(current)]);
    await expect.poll(async () => (await stored(page)).wrong[idOf(current)]).toBeTruthy();
    await nextFrames(page);
    await expect(page.locator('.question-card .review-remove')).toHaveCount(0);
    expect(await spot(next), '下一題移動了').toEqual(before);
    // 下一題、上一題回來：重新畫，這時在名單上
    await next.click();
    await page.getByRole('button', { name: /上一題/ }).click();
    await expect(page.locator('.question-card .review-remove').getByRole('button', { name: '移出待複習' })).toBeVisible();
  });
});

test('結果頁 375px：別的分頁清掉待複習錯題，錯題區的說明兩行換成一行但不變矮，第一張卡的星號不動', async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await toResultWithWrongCards(page, 'normal');
  const hint = page.locator('.wrong-review-hint');
  await hint.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 150));
  await nextFrames(page);
  const firstStar = page.locator('.wrong-item').first().getByRole('button', { name: /加星號/ });
  const spot = () => firstStar.evaluate((el) => ({ top: el.getBoundingClientRect().top, scrollY: window.scrollY }));
  const textHeight = () =>
    hint.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect().height;
    });
  const tall = await textHeight();
  const before = await spot();
  const other = await context.newPage();
  await other.goto('/');
  await other.evaluate((key) => window.localStorage.setItem(key, JSON.stringify({ v: 1, seeded: true, stars: {}, wrong: {} })), KEY);
  await other.close();
  await expect(hint).toHaveText('這幾題都已不在待複習清單上。');
  await nextFrames(page);
  // 前提：換的那一句少一行，不然量不到變矮
  expect(await textHeight(), '前提：換的那一句比較矮').toBeLessThan(tall - 10);
  expect(await spot(), '第一張卡的星號移動了').toEqual(before);
});
