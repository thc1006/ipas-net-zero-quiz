import { test, expect } from '@playwright/test';

/**
 * 測驗流程 E2E 測試
 */
test.describe('測驗流程', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
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

    // 練習模式下應看到答案回饋
    const optionWithFeedback = page.locator('.option-item.correct, .option-item.incorrect');
    await expect(optionWithFeedback).toBeVisible();
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

    // 完成測驗
    await page.getByRole('button', { name: /完成|結束/i }).click();

    // 應看到結果頁面（顯示分數和評語）
    await expect(page.locator('.result-page')).toBeVisible();
    await expect(page.locator('.score-value')).toBeVisible();
    await expect(page.locator('.score-label')).toBeVisible();
  });
});

test.describe('無障礙功能', () => {
  test('應能切換深色模式', async ({ page }) => {
    await page.goto('/');

    // 找到深色模式切換按鈕
    const darkModeToggle = page.getByRole('button', { name: /深色|dark/i });
    await darkModeToggle.click();

    // 檢查 data-theme 屬性
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('鍵盤導覽應正常運作', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /開始測驗/i }).click();
    await expect(page.locator('.question-card')).toBeVisible();

    // 使用 Tab 鍵導覽
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    // 第一個選項應獲得焦點
    const focusedElement = page.locator(':focus');
    await expect(focusedElement).toBeVisible();
  });

  test('選項應有正確的 ARIA 屬性', async ({ page }) => {
    await page.goto('/');
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
    await page.goto('/');

    // 標題應可見
    await expect(page.locator('h1')).toBeVisible();

    // 開始按鈕應可見
    await expect(page.getByRole('button', { name: /開始測驗/i })).toBeVisible();
  });
});
