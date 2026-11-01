import { test, expect, type Page } from '@playwright/test';

/**
 * 測驗流程 E2E 測試
 */
// PR #37 加了首次自動彈 PracticeOptInDialog；e2e test 需先設定 seen flag
// 才能 click 主畫面元件不被 dialog overlay 擋住
async function gotoHome(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('practice-pool-disclosure-seen', '1');
  });
  await page.goto('/');
}

test.describe('測驗流程', () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
  });

  test('首頁應顯示標題', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('淨零碳');
  });

  test('應能選擇考科並開始測驗', async ({ page }) => {
    // 選擇考科
    await page.getByRole('button', { name: /開始測驗/i }).click();

    // 應看到題目
    await expect(page.locator('.question-card')).toBeVisible();
    await expect(page.getByText(/第 1 題/)).toBeVisible();
  });

  test('應能選擇選項並看到回饋', async ({ page }) => {
    // 開始測驗
    await page.getByRole('button', { name: /開始測驗/i }).click();

    // 等待題目載入
    await expect(page.locator('.question-card')).toBeVisible();

    // 選擇第一個選項
    await page.locator('.option-item').first().click();

    // 練習模式下應看到答案回饋（至少有一個選項顯示正確或錯誤狀態）
    const optionWithFeedback = page.locator('.option-item.correct, .option-item.incorrect');
    await expect(optionWithFeedback.first()).toBeVisible();
  });

  test('應能導覽到下一題', async ({ page }) => {
    await page.getByRole('button', { name: /開始測驗/i }).click();
    await expect(page.locator('.question-card')).toBeVisible();

    // 選擇答案
    await page.locator('.option-item').first().click();

    // 點擊下一題
    await page.getByRole('button', { name: /下一題/i }).click();

    // 應看到第 2 題
    await expect(page.getByText(/第 2 題/)).toBeVisible();
  });

  test('完成測驗後應顯示結果', async ({ page }) => {
    // 快速測驗（只有 3 題）
    await page.getByLabel(/題數/i).fill('3');
    await page.getByRole('button', { name: /開始測驗/i }).click();

    // 快速作答 3 題
    for (let i = 0; i < 3; i++) {
      await page.locator('.option-item').first().click();

      if (i < 2) {
        await page.getByRole('button', { name: /下一題/i }).click();
      }
    }

    // 完成測驗（match「完成測驗」substring，避免撞到 PR #75 新加的「結束並返回首頁」
    // abort 按鈕；舊 regex /完成|結束/i 會兩個都中觸發 strict mode violation）
    await page.getByRole('button', { name: /完成測驗/i }).click();

    // 應看到結果頁面（顯示分數和評語）
    await expect(page.locator('.result-page')).toBeVisible();
    await expect(page.locator('.score-value')).toBeVisible();
    await expect(page.locator('.score-label')).toBeVisible();
  });

  // 參考樣題照原卷順序、全選 A 時答錯的題目固定，不靠隨機；jsdom 不排版也不算 CSS，只有真瀏覽器量得到
  test('錯題卡列出每個選項，底色與圖示對得上正確答案和你的答案', async ({ page }) => {
    await page.getByLabel('題目來源').selectOption('sample:114');
    await page.getByLabel('隨機出題順序').uncheck();
    await page.getByLabel(/題數/i).fill('10');
    await page.getByRole('button', { name: /開始測驗/i }).click();

    for (let i = 0; i < 10; i++) {
      await page.locator('.option-item').first().click();
      if (i < 9) await page.getByRole('button', { name: /下一題/i }).click();
    }
    await page.getByRole('button', { name: /完成測驗/i }).click();

    const [successTint, errorTint, none] = await page.evaluate(() => {
      const probe = document.body.appendChild(document.createElement('span'));
      const read = (background: string) => {
        probe.style.background = background;
        return getComputedStyle(probe).backgroundColor;
      };
      const colors = [read('var(--color-success-bg)'), read('var(--color-error-bg)'), read('transparent')];
      probe.remove();
      return colors;
    });

    const cards = page.locator('.wrong-item');
    await expect(cards.first()).toBeVisible();
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const options = cards.nth(i).getByRole('list', { name: '選項' }).getByRole('listitem');
      await expect(options).toHaveCount(4);
      const correct = options.filter({ has: page.getByRole('img', { name: '正確答案' }) });
      const selected = options.filter({ has: page.getByRole('img', { name: '你的答案' }) });
      await expect(correct).toHaveCount(1);
      await expect(selected).toHaveCount(1);
      await expect(correct).toHaveCSS('background-color', successTint);
      await expect(selected).toHaveCSS('background-color', errorTint);
      await expect(options.filter({ hasNot: page.getByRole('img') }).first()).toHaveCSS('background-color', none);
    }
  });

  // gist-1 的卡原本會撐寬頁面（Chromium 在 390px 寬是 477px），勾與叉被推出畫面；另外注入不能斷行的字串，涵蓋題幹與選項
  test('手機寬度：長網址與不能斷行的字串不會撐寬頁面，勾與叉都在畫面裡', async ({ page }) => {
    await page.route('https://js.puter.com/v2/', (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `window.puter = { ai: { chat: async () => '回覆' }, auth: { isSignedIn: () => true, getUser: async () => ({ username: 'stub' }), signIn: async () => {} } };`,
      })
    );
    await page.setViewportSize({ width: 320, height: 800 });
    await page.getByLabel('隨機出題順序').uncheck();
    await page.getByLabel(/題數/i).fill('1');
    await page.getByRole('button', { name: /開始測驗/i }).click();
    await page.locator('.option-item').first().click();
    await page.getByRole('button', { name: /完成測驗/i }).click();

    await expect(page.locator('.wrong-explanation__body').first()).toHaveCSS('white-space', 'pre-line');
    const realOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(realOverflow, 'gist-1 的錯題卡把頁面撐寬了').toBe(0);

    await page.locator('.btn-ai').click();
    await page.locator('.ai-content p').first().waitFor();

    const long = 'x'.repeat(200);
    for (const selector of ['.wrong-stem', '.wrong-option__text', '.wrong-explanation__body', '.answer-evidence__link', '.ai-content p']) {
      await page.locator(selector).first().evaluate((el, text) => {
        el.textContent = text;
      }, long);
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, '錯題卡把頁面撐寬了').toBe(0);
    for (const icon of await page.locator('.wrong-option [role="img"]').all()) {
      const box = (await icon.boundingBox())!;
      expect(box.x + box.width, '勾或叉被推出畫面').toBeLessThanOrEqual(320);
    }
  });

  // 題目頁的解析與結果頁是兩份樣式：gist-1 在這裡一樣會撐寬頁面，分段也要留著
  test('手機寬度：題目頁的解析不會撐寬頁面，分段也留著', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.getByLabel('隨機出題順序').uncheck();
    await page.getByRole('button', { name: /開始測驗/i }).click();
    await page.locator('.option-item').first().click();

    const body = page.locator('.curated-explanation__body');
    await expect(body).toBeVisible();
    await expect(body).toHaveCSS('white-space', 'pre-line');
    await page.locator('.option-text').first().evaluate((el) => {
      el.textContent = 'x'.repeat(200);
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, '題目頁的解析或選項把頁面撐寬了').toBe(0);
  });

  // 相似題的題幹與選項沒有 word-break 時，展開後頁面會被撐寬，勾與叉也跟著被推出畫面
  test('手機寬度：展開題庫相似題也不會撐寬頁面，勾與叉都在畫面裡', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.getByLabel('隨機出題順序').uncheck();
    await page.getByLabel(/題數/i).fill('20');
    await page.getByRole('button', { name: /開始測驗/i }).click();
    for (let i = 0; i < 20; i++) {
      await page.locator('.option-item').first().click();
      if (i < 19) await page.getByRole('button', { name: /下一題/i }).click();
    }
    await page.getByRole('button', { name: /完成測驗/i }).click();

    const toggles = page.getByRole('button', { name: '題庫相似題', exact: false });
    await expect(toggles.first()).toBeVisible();
    const count = await toggles.count();
    expect(count).toBeGreaterThan(3);
    for (let i = 0; i < count; i++) await toggles.nth(i).click();
    await expect(page.getByRole('button', { name: '收起題庫相似題' })).toHaveCount(count);

    const long = 'x'.repeat(200);
    for (const selector of ['.similar-stem', '.bank-similar-option .option-text']) {
      await page.locator(selector).first().evaluate((el, text) => {
        el.textContent = text;
      }, long);
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, '展開相似題把頁面撐寬了').toBe(0);
    for (const icon of await page.locator('.wrong-option [role="img"]').all()) {
      const box = (await icon.boundingBox())!;
      expect(box.x + box.width, '勾或叉被推出畫面').toBeLessThanOrEqual(320);
    }
  });

  // 有跳題時結果頁會多出第 5 張「未作答」統計卡；驗證 grid（auto-fit）讓五張卡在桌面
  // 同一列、不落單（jsdom 無法算版面，只有真實瀏覽器測得到，故放 E2E）。
  test('跳題後結果頁的五張統計卡在桌面寬度同列、不落單', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByLabel(/題數/i).fill('3');
    await page.getByRole('button', { name: /開始測驗/i }).click();
    await expect(page.locator('.question-card')).toBeVisible();

    // 第 1 題「跳過」（練習模式允許不選就下一題）→ 產生「未作答」
    await page.getByRole('button', { name: /下一題/i }).click();
    // 第 2 題作答後下一題
    await page.locator('.option-item').first().click();
    await page.getByRole('button', { name: /下一題/i }).click();
    // 第 3 題作答後完成
    await page.locator('.option-item').first().click();
    await page.getByRole('button', { name: /完成測驗/i }).click();

    await expect(page.locator('.result-page')).toBeVisible();
    // 第 5 張「未作答」卡存在
    await expect(page.locator('.stat-item.skipped')).toContainText('未作答');

    // 五張卡都在同一列 —— 取 bounding box 的 top，全部相同才算沒有落單到第二列
    const cards = page.locator('.stats-section .stat-item');
    await expect(cards).toHaveCount(5);
    const tops = await cards.evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().top))
    );
    expect(new Set(tops).size, `五張卡應在同一列，實得 top=${JSON.stringify(tops)}`).toBe(1);
  });
});

test.describe('無障礙功能', () => {
  test('應能切換深色模式', async ({ page }) => {
    await gotoHome(page);

    // 找到深色模式切換按鈕
    const darkModeToggle = page.getByRole('button', { name: /深色|dark/i });
    await darkModeToggle.click();

    // 檢查 data-theme 屬性
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('鍵盤導覽應正常運作', async ({ page }) => {
    await gotoHome(page);
    await page.getByRole('button', { name: /開始測驗/i }).click();
    await expect(page.locator('.question-card')).toBeVisible();

    // 使用 Tab 鍵連續按到打進 quiz 互動元件（最多 12 次 — 超過代表 tab order 異常）。
    // 期待焦點落在以下任一 quiz 內可互動元件（純 CSS selector，避免 Playwright-only
    // 偽類在 Element.matches 失效）：
    //   - .quiz-abort-btn（abort button）
    //   - .quiz-navigation button（上一題 / 下一題 / 完成）
    //   - input[type="radio"][name="quiz-option"]（題目選項，sr-only 但 keyboard 可操作）
    // 不用 :focus toBeVisible — radio 用 sr-only 樣式（用 label 顯示），
    // playwright 視為 invisible 但 keyboard 仍可操作。
    const interactiveSelector =
      '.quiz-abort-btn, .quiz-navigation button, input[type="radio"][name="quiz-option"]';

    let landed = false;
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate((sel) => {
        const el = document.activeElement;
        if (!el || el === document.body) return false;
        return el.matches(sel);
      }, interactiveSelector);
      if (focused) {
        landed = true;
        break;
      }
    }
    expect(landed, 'Tab 序列應在 12 次內到達 quiz 互動元件').toBe(true);
  });

  test('選項應有正確的 ARIA 屬性', async ({ page }) => {
    await gotoHome(page);
    await page.getByRole('button', { name: /開始測驗/i }).click();

    // 應有 radiogroup
    const radioGroup = page.getByRole('radiogroup');
    await expect(radioGroup).toBeVisible();

    // 應有 4 個 radio buttons
    const radios = page.getByRole('radio');
    await expect(radios).toHaveCount(4);
  });

  // 色覺辨認模式：切換後語意色 token 與預覽 chip 的實色條要真的換色（jsdom 算不出 CSS 變數，
  // 只有真瀏覽器測得到）。守住「切了沒反應」這個原始痛點的回歸。
  test('色覺辨認模式切換即時改變回饋語意色', async ({ page }) => {
    await gotoHome(page);
    await page.getByRole('button', { name: '開啟設定' }).click();
    const cvdSelect = page.getByLabel('色覺辨認模式');
    await expect(cvdSelect).toBeVisible();

    // 預覽色條改吃 --color-*-fg（與真實選項回饋同源）；-fg 一樣受 CVD remap。
    // correct 與 incorrect 都要驗 —— 否則 incorrect chip 誤接 success-fg 仍會全綠。
    const cssVar = (name: string) => () =>
      page.evaluate(
        (n) =>
          getComputedStyle(document.documentElement)
            .getPropertyValue(n)
            .trim()
            .toLowerCase(),
        name
      );
    const successFg = cssVar('--color-success-fg');
    const errorFg = cssVar('--color-error-fg');
    const bar = (which: 'correct' | 'incorrect') => () =>
      page
        .locator(`.cvd-preview__chip--${which}`)
        .evaluate((el) => getComputedStyle(el).boxShadow);
    const correctBar = bar('correct');
    const incorrectBar = bar('incorrect');

    // none：correct=success-fg #1b5e20 / rgb(27,94,32)；incorrect=error-fg #b71c1c / rgb(183,28,28)
    await expect.poll(successFg).toBe('#1b5e20');
    await expect.poll(correctBar).toContain('27, 94, 32');
    await expect.poll(errorFg).toBe('#b71c1c');
    await expect.poll(incorrectBar).toContain('183, 28, 28');

    // 切綠色盲 → correct #01579b / rgb(1,87,155)；incorrect #a52a00 / rgb(165,42,0)
    // （poll 容忍 style recalc 的一拍延遲）
    await cvdSelect.selectOption('deuteranopia');
    await expect.poll(successFg).toBe('#01579b');
    await expect.poll(correctBar).toContain('1, 87, 155');
    await expect.poll(errorFg).toBe('#a52a00');
    await expect.poll(incorrectBar).toContain('165, 42, 0');
  });
});

// App 依練習模式決定混不混練習池，按鈕在首頁：這一條不能重新整理，重新載入會把兩邊的值對齊
test.describe('加強練習池', () => {
  async function gotoHomeWithPool(page: import('@playwright/test').Page, enabled: boolean): Promise<void> {
    await page.addInitScript((poolEnabled) => {
      window.localStorage.setItem('practice-pool-ai-opt-in', '1');
      window.localStorage.setItem('practice-pool-enabled', poolEnabled ? '1' : '0');
    }, enabled);
    await gotoHome(page);
  }

  async function poolQuestionsInHundred(page: import('@playwright/test').Page): Promise<number> {
    await page.getByLabel('題數').fill('100');
    await page.getByRole('button', { name: /開始測驗/i }).click();
    await expect(page.locator('.question-card')).toBeVisible();
    // 進度裡主題庫題只存 id，練習池題存整包物件（utils/quiz-progress-storage.ts）
    return page.evaluate(() => {
      const saved = JSON.parse(window.localStorage.getItem('ipas-quiz-in-progress-v2')!);
      return saved.state.questions.filter((q: unknown) => typeof q !== 'string').length;
    });
  }

  test('在首頁啟用：下一場混入練習池', async ({ page }) => {
    await gotoHomeWithPool(page, false);
    await page.getByRole('button', { name: '啟用加強練習池' }).click();
    expect(await poolQuestionsInHundred(page)).toBeGreaterThan(0);
  });

  test('在首頁停用：下一場不混入練習池', async ({ page }) => {
    await gotoHomeWithPool(page, true);
    await page.getByRole('button', { name: '停用加強練習池' }).click();
    expect(await poolQuestionsInHundred(page)).toBe(0);
  });
});

// #150 把參考樣題的 id 改成來源代號，瀏覽器裡的舊進度與舊統計還是舊 id。
// 第一題 S1-p01-q004 是 S_IPAS_SAMPLE_114_L11-q004 的舊 id（metadata.renamed_from）
test.describe('題目改過 id', () => {
  const OLD_ID = 'S1-p01-q004';

  async function seed(page: Page, entries: Record<string, unknown>): Promise<void> {
    await page.addInitScript((seeded) => {
      window.localStorage.setItem('practice-pool-disclosure-seen', '1');
      for (const [key, value] of Object.entries(seeded)) {
        window.localStorage.setItem(key, JSON.stringify(value));
      }
    }, entries);
  }

  const save = (answers: unknown[]) => ({
    version: 2,
    savedAt: Date.now(),
    state: {
      isActive: true,
      questions: [OLD_ID, 'gist-1'],
      currentIndex: 0,
      answers,
      startTime: Date.now(),
      config: {
        mode: 'practice',
        subject: 'all',
        questionCount: 2,
        shuffleQuestions: false,
        showAnswerImmediately: true,
      },
    },
  });

  test('舊進度照常續作，作答紀錄與題卡上的統計都接得上', async ({ page }) => {
    await seed(page, {
      'ipas-quiz-in-progress-v2': save([
        {
          questionId: OLD_ID,
          selectedAnswer: 'A',
          correctAnswer: 'A',
          isCorrect: true,
          timeSpent: 1,
          timestamp: 1,
          sourceCategory: 'main_bank',
        },
      ]),
      'ipas-question-stats': { version: 1, items: { [OLD_ID]: { attempts: 4, correct: 1, lastTriedAt: 1 } } },
    });
    await page.goto('/');

    const resume = page.getByRole('button', { name: /繼續測驗/ });
    await expect(resume).toBeVisible();
    await resume.click();

    await expect(page.locator('.question-card')).toBeVisible();
    await expect(page.locator('.question-options input:checked')).toHaveValue('A');
    await expect(page.locator('.option-item.correct')).toHaveCount(1);
    await expect(page.getByTestId('question-stat-chip')).toContainText('答對率 25%');
  });

  test('最常答錯：舊 id 算到現在的題目，找不到題目的 id 不佔前 10 名', async ({ page }) => {
    const stale = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`S9-p01-q${i}`, { attempts: 9, correct: 0, lastTriedAt: 1 }])
    );
    await seed(page, {
      'ipas-question-stats': {
        version: 1,
        items: { ...stale, [OLD_ID]: { attempts: 4, correct: 1, lastTriedAt: 1 } },
      },
    });
    await page.goto('/');
    await page.getByLabel('隨機出題順序').focus();
    await page.keyboard.press('Space');
    await page.locator('#count').fill('1');

    await page.getByRole('button', { name: /開始測驗/ }).click();
    await page.locator('.option-item').first().click();
    await page.getByRole('button', { name: /完成測驗/ }).click();

    await expect(page.getByTestId('weak-section').locator('.weak-item')).toHaveCount(1);
  });
});

test.describe('響應式設計', () => {
  test('行動裝置應正常顯示', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await gotoHome(page);

    // 標題應可見
    await expect(page.locator('h1')).toBeVisible();

    // 開始按鈕應可見
    await expect(page.getByRole('button', { name: /開始測驗/i })).toBeVisible();
  });
});
