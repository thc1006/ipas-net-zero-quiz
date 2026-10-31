import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * 練習模式選了就鎖定，而原生 radio 的方向鍵會同時移動與選取：第一次按方向鍵就交卷了。
 * 三個引擎的方向鍵、Tab 落點都不一樣（Firefox 原本走不到選項 C），jsdom 也沒有 radio 的預設行為，
 * 所以每個引擎都實際按一次。
 */

const KEYS = ['A', 'B', 'C', 'D'];

async function startQuiz(page: Page, mode: 'practice' | 'exam', count?: number): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('practice-pool-disclosure-seen', '1');
  });
  await page.goto('/');
  await page.locator('#mode').selectOption(mode);
  // 不隨機：每次都是同一題
  await page.getByLabel('隨機出題順序').focus();
  await page.keyboard.press('Space');
  if (count) await page.locator('#count').fill(String(count));
  await page.getByRole('button', { name: /開始測驗/ }).click();
  await expect(page.locator('.question-card')).toBeVisible();
  await expect(options(page)).toHaveCount(4);
}

const options = (page: Page) => page.locator('.question-options input[type="radio"]');
const nextButton = (page: Page) => page.getByRole('button', { name: /下一題/ });
const hint = (page: Page) => page.getByText('按 Enter 或空白鍵確認答案');
const outcome = (page: Page) => page.locator('.nav-center').getByRole('status');

/** 元素的高度完全落在 sticky header 下緣與視窗底部之間；toBeVisible 不管有沒有被 header 蓋住 */
async function expectBelowHeader(page: Page, target: Locator, where: string): Promise<void> {
  const m = await target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      headerBottom: document.querySelector('.app-header')!.getBoundingClientRect().bottom,
      viewport: innerHeight,
    };
  });
  expect(m.top, `${where} ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(m.headerBottom);
  expect(m.bottom, `${where} ${JSON.stringify(m)}`).toBeLessThanOrEqual(m.viewport);
}

/** Tab 進選項群組（群組前面最後一個可聚焦的是回報連結），停在第一個選項 */
async function tabIntoOptions(page: Page): Promise<void> {
  await page.locator('.question-feedback-link').focus();
  await page.keyboard.press('Tab');
  await expect(options(page).first()).toBeFocused();
}

/** 還沒作答：四個選項都能操作，也還沒顯示對錯 */
async function expectNotAnswered(page: Page): Promise<void> {
  await expect(page.locator('.question-options input:disabled')).toHaveCount(0);
  await expect(page.locator('.option-item.correct, .option-item.incorrect')).toHaveCount(0);
}

/** 已作答：鎖定、顯示對錯，選的是 key */
async function expectAnswered(page: Page, key: string): Promise<void> {
  await expect(page.locator('.question-options input:disabled')).toHaveCount(4);
  await expect(page.locator('.option-item.correct')).toHaveCount(1);
  await expect(page.locator('.question-options input:checked')).toHaveValue(key);
}

test.describe('練習模式的鍵盤作答', () => {
  for (const [commit, press] of [['Enter', 'Enter'], ['空白鍵', 'Space']] as const) {
    KEYS.forEach((key, index) => {
      test(`方向鍵走到 ${key}，${commit}才作答；作答後焦點在下一題，放開按鍵不會跳題`, async ({ page }) => {
        await startQuiz(page, 'practice');
        await tabIntoOptions(page);
        await expect(hint(page)).toBeVisible(); // 按方向鍵之前就要看得到

        for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown');

        await expect(options(page).nth(index)).toBeFocused();
        await expectNotAnswered(page);
        await expect(hint(page)).toBeVisible();
        if (index > 0) {
          await expect(page.locator('.question-options input:checked')).toHaveValue(key);
          await expect(page.locator('.option-item.selected')).toHaveCount(1);
          await expect(page.locator('.option-item').nth(index)).toHaveClass(/selected/);
        }

        await page.keyboard.press(press);

        await expectAnswered(page, key);
        await expect(nextButton(page)).toBeFocused();
        await expect(page.getByText('第 1 題')).toBeVisible();

        await page.keyboard.press('Enter');
        await expect(page.getByText('第 2 題')).toBeVisible();
      });
    });
  }

  test('上下左右都能移動，頭尾相接', async ({ page }) => {
    await startQuiz(page, 'practice');
    await tabIntoOptions(page);

    await page.keyboard.press('ArrowUp');
    await expect(options(page).nth(3)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(options(page).nth(0)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(options(page).nth(1)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(options(page).nth(0)).toBeFocused();
    await page.keyboard.press('Shift+ArrowDown');
    await expect(options(page).nth(1)).toBeFocused();
    await expectNotAnswered(page);
  });

  test('從下一題按 Shift+Tab 回到選項群組，一樣走得到每個選項', async ({ page }) => {
    await startQuiz(page, 'practice');
    await nextButton(page).focus();
    await page.keyboard.press('Shift+Tab'); // 第一題的上一題是停用的，直接進群組

    // 落點各引擎不同（沒有已選的選項時 Firefox 停在第一個，其他停在最後一個）
    const entry = await page.evaluate(() => (document.activeElement as HTMLInputElement).value);
    expect(KEYS).toContain(entry);

    const reached = new Set<string>([entry]);
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowDown');
      reached.add(await page.evaluate(() => (document.activeElement as HTMLInputElement).value));
    }
    expect([...reached].sort()).toEqual(KEYS);
    await expectNotAnswered(page);
  });

  // 留著選中的樣子與提示，使用者照提示按 Enter 時焦點已經在下一題，等於跳過這題
  test('移到選項後 Tab 離開：不留選中的樣子，提示收起；回來還能作答', async ({ page }) => {
    await startQuiz(page, 'practice');
    await tabIntoOptions(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.option-item.selected')).toHaveCount(1);

    await page.keyboard.press('Tab');

    await expect(nextButton(page)).toBeFocused();
    await expect(page.locator('.option-item.selected')).toHaveCount(0);
    await expect(page.locator('.question-options input:checked')).toHaveCount(0);
    await expect(hint(page)).toHaveCount(0);
    await expectNotAnswered(page);

    await page.keyboard.press('Shift+Tab');
    await expect(hint(page)).toBeVisible();
    const focused = await page.evaluate(() => (document.activeElement as HTMLInputElement).value);
    await page.keyboard.press('Enter');
    await expectAnswered(page, focused);
  });

  test('滑鼠按著選項還沒放開：提示不會閃出來', async ({ page }) => {
    await startQuiz(page, 'practice');
    const box = (await page.locator('.option-item').nth(1).boundingBox())!;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(hint(page)).toHaveCount(0);
    await page.mouse.up();

    await expectAnswered(page, 'B');
    await expect(hint(page)).toHaveCount(0);
  });

  // 長按時後面的 keydown 帶 repeat，焦點已經在下一題：不擋的話會一路跳題
  for (const press of ['Enter', 'Space']) {
    test(`長按 ${press} 作答，不會連帶按到下一題`, async ({ page }) => {
      await startQuiz(page, 'practice');
      await tabIntoOptions(page);

      await page.keyboard.down(press);
      await page.keyboard.down(press);
      await page.keyboard.down(press);
      await page.keyboard.up(press);

      await expectAnswered(page, 'A');
      await expect(page.getByText('第 1 題')).toBeVisible();
    });
  }

  test('移到選項但沒確認就按下一題：這題算沒作答，回來還能答', async ({ page }) => {
    await startQuiz(page, 'practice');
    await tabIntoOptions(page);
    await page.keyboard.press('ArrowDown');
    await expectNotAnswered(page);

    await nextButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('第 2 題')).toBeVisible();

    await page.getByRole('button', { name: /上一題/ }).click();
    await expect(page.getByText('第 1 題')).toBeVisible();
    await expectNotAnswered(page);
    await expect(page.locator('.question-options input:checked')).toHaveCount(0);
  });

  test('滑鼠點選項照舊：提示區不佔版面，點了就作答，焦點不會被移走', async ({ page }) => {
    await startQuiz(page, 'practice');
    const status = page.locator('.question-card').getByRole('status');
    expect((await status.boundingBox())?.height).toBe(0);
    await expect(status).toHaveCSS('margin-top', '0px');

    await page.locator('.option-item').nth(2).click();

    await expectAnswered(page, 'C');
    await expect(nextButton(page)).not.toBeFocused();
  });

  // 移到的選項已經是 checked，再點不會有 change，要看 click
  for (const [name, activate] of [
    ['滑鼠點文字', (page: Page) => page.locator('.option-item').nth(1).locator('.option-text').click()],
    ['滑鼠點代號', (page: Page) => page.locator('.option-item').nth(1).locator('.option-key').click()],
    ['輔助工具觸發 click', (page: Page) => options(page).nth(1).evaluate((el) => (el as HTMLInputElement).click())],
  ] as const) {
    test(`方向鍵移到 B 再用${name}點 B：作答`, async ({ page }) => {
      await startQuiz(page, 'practice');
      await tabIntoOptions(page);
      await page.keyboard.press('ArrowDown');
      await expectNotAnswered(page);

      await activate(page);

      await expectAnswered(page, 'B');
    });
  }

  // 滑鼠按下時焦點離開選項、提示收起。提示佔版面的話選項會移位，放開時已經不在同一個選項上，click 就沒了
  test('提示收起時版面不動：按著滑鼠等提示收起，放開照樣作答', async ({ page }) => {
    await startQuiz(page, 'practice');
    await tabIntoOptions(page);
    await page.keyboard.press('ArrowDown');
    // 題卡進場有 transform 動畫，字型晚到也會改行高，都等完再量
    await page.locator('.question-card').evaluate((el) =>
      Promise.all([...el.getAnimations().map((a) => a.finished.catch(() => undefined)), document.fonts.ready])
    );
    const option = page.locator('.option-item').nth(1);
    const before = (await option.boundingBox())!;

    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await expect(hint(page)).toHaveCount(0);
    expect((await option.boundingBox())!.y).toBe(before.y);
    await page.mouse.up();

    await expectAnswered(page, 'B');
  });

  test('往下再回到 A 再點 A：作答', async ({ page }) => {
    await startQuiz(page, 'practice');
    await tabIntoOptions(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await expectNotAnswered(page);

    await options(page).nth(0).evaluate((el) => (el as HTMLInputElement).click());

    await expectAnswered(page, 'A');
  });

  test('方向鍵移到一半改用滑鼠點別的選項：以點的那個為準', async ({ page }) => {
    await startQuiz(page, 'practice');
    await tabIntoOptions(page);
    await page.keyboard.press('ArrowDown');
    await expectNotAnswered(page);

    await page.locator('.option-item').nth(3).click();

    await expectAnswered(page, 'D');
  });

  test.describe('觸控', () => {
    test.use({ hasTouch: true });

    test('點選項照舊：點了就作答，焦點不會被移走', async ({ page }) => {
      await startQuiz(page, 'practice');

      await page.locator('.option-item').nth(1).tap();

      await expectAnswered(page, 'B');
      await expect(nextButton(page)).not.toBeFocused();
    });

    test('方向鍵移到 B 再點 B：作答', async ({ page }) => {
      await startQuiz(page, 'practice');
      await tabIntoOptions(page);
      await page.keyboard.press('ArrowDown');

      await page.locator('.option-item').nth(1).tap();

      await expectAnswered(page, 'B');
    });
  });

  // WebKit 在 Ctrl、Alt、Meta 加方向鍵時也會點下一個選項，放行就直接交卷
  for (const shortcut of ['Control+ArrowDown', 'Alt+ArrowDown', 'Meta+ArrowDown', 'Control+ArrowLeft', 'Alt+ArrowUp']) {
    test(`${shortcut} 不作答也不移動`, async ({ page }) => {
      await startQuiz(page, 'practice');
      await tabIntoOptions(page);

      await page.keyboard.press(shortcut);

      await expect(options(page).first()).toBeFocused();
      await expect(page.locator('.question-options input:checked')).toHaveCount(0);
      await expectNotAnswered(page);
    });
  }

  const VIEWPORTS = [[1280, 720], [390, 844], [360, 640], [844, 390], [320, 256], [341, 192]];

  // 提示在第四個選項下方時矮視窗看不到；移到哪個選項都要看得到提示和那個選項
  for (const [width, height] of VIEWPORTS) {
    test(`${width}x${height}：提示與移到的選項都在 header 下面、視窗之內`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await startQuiz(page, 'practice');
      await tabIntoOptions(page);

      const expectBothVisible = async (i: number, way: string) => {
        await expect(options(page).nth(i)).toBeFocused();
        const key = page.locator('.option-item').nth(i).locator('.option-key');
        await expectBelowHeader(page, hint(page), `往${way}到第 ${i + 1} 個選項的提示`);
        await expectBelowHeader(page, key, `往${way}到第 ${i + 1} 個選項`);
        const [message, option] = [await hint(page).boundingBox(), await key.boundingBox()];
        expect(message!.y + message!.height, `往${way}到第 ${i + 1} 個選項沒有被提示蓋住`).toBeLessThanOrEqual(option!.y + 1);
      };

      for (let i = 0; i < 4; i++) {
        await expectBothVisible(i, '下');
        if (i < 3) await page.keyboard.press('ArrowDown');
      }
      for (let i = 2; i >= 0; i--) {
        await page.keyboard.press('ArrowUp');
        await expectBothVisible(i, '上');
      }
    });
  }

  // 提示的高度隨字級變；它要放在題幹與選項之間的空隙裡，不能壓到題幹最後一行。
  // 200% 縮放是 CSS 視窗減半、deviceScaleFactor 2
  for (const [label, width, height, scale] of [
    ['1280x720', 1280, 720, 1],
    ['360x640', 360, 640, 1],
    ['1280x720 放大 200%', 640, 360, 2],
  ] as const) {
    test(`${label}：每種字級，提示都不蓋到題幹最後一行`, async ({ browser, baseURL }) => {
      const bad: string[] = [];
      for (const fontSize of ['normal', 'large', 'xlarge']) {
        const context = await browser.newContext({ baseURL, viewport: { width, height }, deviceScaleFactor: scale });
        const page = await context.newPage();
        await page.addInitScript((size) => {
          window.localStorage.setItem('ipas-quiz-a11y', JSON.stringify({ fontSize: size }));
        }, fontSize);
        await startQuiz(page, 'practice');
        await page.locator('.question-card').evaluate((el) =>
          Promise.all([...el.getAnimations().map((a) => a.finished.catch(() => undefined)), document.fonts.ready])
        );
        await tabIntoOptions(page);
        await expect(hint(page)).toBeVisible();

        const m = await hint(page).evaluate((el) => {
          const range = document.createRange();
          range.selectNodeContents(document.querySelector('.question-stem p')!);
          const lastLine = [...range.getClientRects()].reduce((a, b) => (b.bottom > a.bottom ? b : a));
          const box = el.getBoundingClientRect();
          return { hintTop: box.top, hintBottom: box.bottom, lastLineBottom: lastLine.bottom };
        });
        if (m.hintTop < m.lastLineBottom) bad.push(`${fontSize} ${JSON.stringify(m)}`);
        await context.close();
      }
      expect(bad).toEqual([]);
    });
  }

  // 矮視窗移到最後一個選項時，提示貼在 header 下面，底下是捲上去的題幹與選項：沒有底色兩行字會疊在一起
  test('844x390 移到 D：提示貼在 header 下、壓在捲上去的內容上，底色不透明', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await startQuiz(page, 'practice');
    await tabIntoOptions(page);
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await expect(options(page).nth(3)).toBeFocused();

    const m = await hint(page).evaluate((el) => {
      const box = el.getBoundingClientRect();
      const covered = [...document.querySelectorAll('.question-stem p, .option-item')].some((other) => {
        const r = other.getBoundingClientRect();
        return r.bottom > box.top && r.top < box.bottom;
      });
      return { covered, background: getComputedStyle(el).backgroundColor };
    });
    expect(m.covered, '這個情境下提示真的壓在內容上').toBe(true);
    const alpha = m.background.match(/rgba\([^)]*,\s*([\d.]+)\)/)?.[1];
    expect(m.background, '底色不能透明').not.toBe('transparent');
    expect(alpha === undefined ? 1 : Number(alpha)).toBe(1);
  });

  test('提示在選項上方', async ({ page }) => {
    await startQuiz(page, 'practice');
    await tabIntoOptions(page);

    // 同一刻量：題卡進場有 transform 動畫
    const order = await hint(page).evaluate((el) => {
      const first = document.querySelector('.option-item')!.getBoundingClientRect();
      return [el.getBoundingClientRect().bottom, first.top];
    });
    expect(order[0]).toBeLessThanOrEqual(order[1]);
  });

  // 按鈕要等解析畫出來才知道在哪；header 固定在上面，選項的上緣不能跑到 header 底下
  for (const [width, height] of VIEWPORTS) {
    test(`${width}x${height}：作答後對錯與下一題都在視窗內，放得下時正確選項也在`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await startQuiz(page, 'practice', 6);
      let bothFit = 0;

      for (let i = 1; i <= 6; i++) {
        await expect(page.getByText(`第 ${i} 題`)).toBeVisible();
        await tabIntoOptions(page);
        await page.keyboard.press('Enter');
        const next = page.getByRole('button', { name: /下一題|完成測驗/ });
        await expect(next).toBeFocused();
        await expect(page.locator('.option-item.correct')).toHaveCount(1);
        await expect(outcome(page)).toHaveText(/^答(對了|錯了，正確答案是 [A-D])$/);
        await expectBelowHeader(page, outcome(page), `第 ${i} 題的對錯`);
        // sr-only 也算 visible、也在視窗內，要量得出一行字的高度
        expect((await outcome(page).boundingBox())!.height).toBeGreaterThanOrEqual(10);

        const m = await page.evaluate(() => {
          const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
          const button = document.activeElement!.getBoundingClientRect();
          return {
            headerBottom: rect('.app-header').bottom,
            buttonTop: button.top,
            buttonBottom: button.bottom,
            correctTop: rect('.option-item.correct').top,
            viewport: innerHeight,
          };
        });
        const where = `第 ${i} 題 ${JSON.stringify(m)}`;
        expect(m.buttonTop, where).toBeGreaterThanOrEqual(m.headerBottom);
        expect(m.buttonBottom, where).toBeLessThanOrEqual(m.viewport);
        // 導覽列捲到離視窗底部 8px（scroll-margin-bottom）
        if (m.buttonBottom - m.correctTop + 8 <= m.viewport - m.headerBottom) {
          expect(m.correctTop, where).toBeGreaterThanOrEqual(m.headerBottom);
          bothFit++;
        }

        if (i < 6) await page.keyboard.press('Enter');
      }
      // 小視窗上解析常比視窗高，兩者放不下時只要求按鈕；大視窗不能全部跳過（反空轉）
      if (height >= 720) expect(bothFit).toBeGreaterThan(0);
    });
  }

  test('鍵盤作答後按下一題：焦點與捲動回到新題幹，Tab 一下就進選項，連按 Enter 不會替下一題作答', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await startQuiz(page, 'practice', 3);
    await tabIntoOptions(page);
    await page.keyboard.press('Enter');
    await expect(nextButton(page)).toBeFocused();

    await page.keyboard.press('Enter');

    await expect(page.getByText('第 2 題')).toBeVisible();
    const stem = page.locator('.question-stem');
    await expect(stem).toBeFocused();
    await expectBelowHeader(page, stem.locator('p'), '新題幹');

    await page.keyboard.press('Enter');
    await expectNotAnswered(page);
    await expect(page.getByText('第 2 題')).toBeVisible();

    await page.keyboard.press('Tab');
    await expect(options(page).first()).toBeFocused();
  });

  test('第 1 題鍵盤、第 2 題滑鼠：滑鼠那題焦點不跳、對錯不多顯示，第 3 題鍵盤照常', async ({ page }) => {
    await startQuiz(page, 'practice', 3);
    await tabIntoOptions(page);
    await page.keyboard.press('Enter');
    await expect(outcome(page)).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByText('第 2 題')).toBeVisible();
    await expect(outcome(page)).toBeEmpty();

    await page.locator('.option-item').first().click();

    await expect(page.locator('.option-item.correct')).toHaveCount(1);
    await expect(nextButton(page)).not.toBeFocused();
    await expect(outcome(page)).toHaveClass('sr-only');
    await expect(outcome(page)).not.toBeEmpty();

    await nextButton(page).click();
    await expect(page.getByText('第 3 題')).toBeVisible();
    await tabIntoOptions(page);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: /完成測驗/ })).toBeFocused();
    await expect(outcome(page)).toBeVisible();
  });

  test('對錯只在作答的那一刻：回到答過的題目不再念一次', async ({ page }) => {
    await startQuiz(page, 'practice', 2);
    await tabIntoOptions(page);
    await page.keyboard.press('Enter');
    await expect(outcome(page)).not.toBeEmpty();
    await page.keyboard.press('Enter');
    await expect(page.getByText('第 2 題')).toBeVisible();

    await page.getByRole('button', { name: /上一題/ }).click();

    await expect(page.getByText('第 1 題')).toBeVisible();
    await expect(outcome(page)).toBeEmpty();
    await expect(page.locator('.option-item.correct')).toHaveCount(1);
  });

  test('滑鼠按下一題：焦點與捲動照舊', async ({ page }) => {
    await startQuiz(page, 'practice', 2);

    await nextButton(page).click();

    await expect(page.getByText('第 2 題')).toBeVisible();
    await expect(page.locator('.question-stem')).not.toBeFocused();
  });

  test('考試模式不變：方向鍵直接改答案，不鎖定、不顯示提示，焦點留在選項', async ({ page }) => {
    await startQuiz(page, 'exam');
    await tabIntoOptions(page);
    await expect(nextButton(page)).toBeDisabled();

    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.question-options input:checked')).toHaveValue('B');
    await expect(nextButton(page)).toBeEnabled();

    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.question-options input:checked')).toHaveValue('C');
    await expect(options(page).nth(2)).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(options(page).nth(2)).toBeFocused();
    await expect(page.locator('.question-options input:disabled')).toHaveCount(0);
    await expect(hint(page)).toHaveCount(0);
    await expect(outcome(page)).toHaveCount(0);

    await nextButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('第 2 題')).toBeVisible();
    await expect(page.locator('.question-stem')).not.toBeFocused();
  });
});
