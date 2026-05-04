import { test, expect } from '@playwright/test';

/**
 * 測驗流程 E2E 測試
 */
// PR #37 加了首次自動彈 PracticeOptInDialog；e2e test 需先設定 seen flag
// 才能 click 主畫面元件不被 dialog overlay 擋住
async function gotoHome(page: import('@playwright/test').Page): Promise<void> {
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
    // 期待焦點落在以下任一可互動元件：abort button / radio input / 上下題 button。
    // 不用 :focus toBeVisible — radio 用 sr-only 樣式（用 label 顯示），
    // playwright 視為 invisible 但 keyboard 仍可操作。
    const interactiveSelector =
      'button.quiz-abort-btn, [role="radio"], input[type="radio"][name="quiz-option"], button:has-text("下一題"), button:has-text("上一題")';

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
