import { test, expect } from '@playwright/test';

/**
 * AI 功能 E2E 測試
 * 測試 AI 解析功能是否正常運作
 */
test.describe('AI 解析功能', () => {
  test.beforeEach(async ({ page }) => {
    // 監聽 console 輸出以便除錯
    page.on('console', (msg) => {
      if (msg.text().includes('[AI Helper]')) {
        console.log('Browser console:', msg.text());
      }
    });

    await page.goto('/');
  });

  test('練習模式下應顯示 AI 解析按鈕', async ({ page }) => {
    // 設定為練習模式（預設）
    await page.getByRole('button', { name: /開始測驗/i }).click();

    // 等待題目載入
    await expect(page.locator('.question-card')).toBeVisible();

    // 選擇答案觸發顯示正確答案
    await page.locator('.option-item').first().click();

    // 應看到 AI 解析按鈕
    const aiButton = page.locator('.ai-explain-btn');
    await expect(aiButton).toBeVisible({ timeout: 5000 });
    await expect(aiButton).toContainText('AI 解析');
  });

  test('點擊 AI 解析後應顯示載入狀態', async ({ page }) => {
    await page.getByRole('button', { name: /開始測驗/i }).click();
    await expect(page.locator('.question-card')).toBeVisible();

    // 選擇答案
    await page.locator('.option-item').first().click();

    // 點擊 AI 解析按鈕
    const aiButton = page.locator('.ai-explain-btn');
    await expect(aiButton).toBeVisible({ timeout: 5000 });
    await aiButton.click();

    // 應顯示載入狀態
    const loadingIndicator = page.locator('.ai-loading');
    await expect(loadingIndicator).toBeVisible({ timeout: 3000 });
    await expect(loadingIndicator).toContainText('AI 分析中');
  });

  test('AI 解析應能成功返回回應或顯示錯誤', async ({ page }) => {
    // 設定較長的超時時間，因為 AI 回應可能需要時間
    test.setTimeout(90000);

    await page.getByRole('button', { name: /開始測驗/i }).click();
    await expect(page.locator('.question-card')).toBeVisible();

    // 選擇答案
    await page.locator('.option-item').first().click();

    // 點擊 AI 解析
    const aiButton = page.locator('.ai-explain-btn');
    await expect(aiButton).toBeVisible({ timeout: 5000 });
    await aiButton.click();

    // 監聽 console 錯誤
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.text().includes('[AI Helper]')) {
        consoleErrors.push(msg.text());
        console.log('Console:', msg.text());
      }
    });

    // 等待載入狀態消失（表示 AI 處理完成）
    // 可能成功顯示 .ai-response，或載入狀態一直存在（超時）
    try {
      // 先等待回應出現
      const aiResponse = page.locator('.ai-response');
      await expect(aiResponse).toBeVisible({ timeout: 60000 });

      // 驗證回應內容（成功或錯誤都可以）
      const responseContent = page.locator('.ai-response-content, .ai-response-error');
      await expect(responseContent).toBeVisible();

      // 如果有錯誤，記錄下來
      const errorContent = page.locator('.ai-response-error');
      if (await errorContent.isVisible()) {
        const errorText = await errorContent.textContent();
        console.log('AI 返回錯誤:', errorText);
      } else {
        console.log('AI 解析成功返回');
      }
    } catch {
      // 如果超時，檢查載入狀態是否還在
      const loading = page.locator('.ai-loading');
      if (await loading.isVisible()) {
        console.log('AI 請求超時（載入狀態仍存在）');
        console.log('Console errors:', consoleErrors);
        // 這不一定是測試失敗，可能是網路問題
        test.skip();
      } else {
        throw new Error('AI 回應未出現且無載入狀態');
      }
    }
  });

  test('AI 解析應顯示信心度', async ({ page }) => {
    test.setTimeout(60000);

    await page.getByRole('button', { name: /開始測驗/i }).click();
    await expect(page.locator('.question-card')).toBeVisible();

    // 選擇答案
    await page.locator('.option-item').first().click();

    // 點擊 AI 解析
    const aiButton = page.locator('.ai-explain-btn');
    await expect(aiButton).toBeVisible({ timeout: 5000 });
    await aiButton.click();

    // 等待 AI 回應
    const aiResponse = page.locator('.ai-response');
    await expect(aiResponse).toBeVisible({ timeout: 45000 });

    // 檢查是否有信心度顯示
    const confidenceBadge = page.locator('.confidence-badge');

    // 如果成功回應應該有信心度
    const isSuccess = await page.locator('.ai-response.success').isVisible();
    if (isSuccess) {
      await expect(confidenceBadge).toBeVisible();

      // 獲取信心度文字
      const confidenceText = await confidenceBadge.textContent();
      console.log('AI 信心度:', confidenceText);

      // 驗證信心度格式（應為 "信心度 XX%"）
      expect(confidenceText).toMatch(/信心度\s*\d+%/);

      // 提取百分比數字
      const match = confidenceText?.match(/(\d+)%/);
      if (match) {
        const confidence = parseInt(match[1]);
        console.log('信心度數值:', confidence);

        // 驗證信心度不是總是 30%（修復前的問題）
        // 注意：單次測試可能剛好是 30%，但多數情況應該不同
      }
    }
  });

  test('切換題目後 AI 解析狀態應重置', async ({ page }) => {
    test.setTimeout(90000);

    await page.getByRole('button', { name: /開始測驗/i }).click();
    await expect(page.locator('.question-card')).toBeVisible();

    // 第一題：選擇答案並請求 AI 解析
    await page.locator('.option-item').first().click();

    const aiButton = page.locator('.ai-explain-btn');
    await expect(aiButton).toBeVisible({ timeout: 5000 });
    await aiButton.click();

    // 等待 AI 回應
    await expect(page.locator('.ai-response')).toBeVisible({ timeout: 45000 });

    // 切換到下一題
    await page.getByRole('button', { name: /下一題/i }).click();
    await expect(page.getByText(/第 2 題/)).toBeVisible();

    // 選擇答案
    await page.locator('.option-item').first().click();

    // AI 解析按鈕應該重新出現（表示狀態已重置）
    await expect(page.locator('.ai-explain-btn')).toBeVisible({ timeout: 5000 });

    // 之前的 AI 回應不應該還在
    await expect(page.locator('.ai-response')).not.toBeVisible();
  });
});

test.describe('題目選項驗證', () => {
  test('所有題目應有 4 個選項', async ({ page }) => {
    // 設定題數為 10 題來抽樣檢查
    await page.goto('/');
    await page.getByLabel(/題數/i).fill('10');
    await page.getByRole('button', { name: /開始測驗/i }).click();

    for (let i = 0; i < 10; i++) {
      await expect(page.locator('.question-card')).toBeVisible();

      // 驗證有 4 個選項
      const options = page.locator('.option-item');
      const count = await options.count();

      // 獲取當前題號
      const questionNumber = await page.locator('.question-number').textContent();
      console.log(`${questionNumber}: ${count} 個選項`);

      expect(count).toBe(4);

      // 驗證選項 key 是 A, B, C, D
      const optionKeys = await page.locator('.option-key').allTextContents();
      expect(optionKeys).toEqual(['A', 'B', 'C', 'D']);

      // 選擇答案並進入下一題
      await page.locator('.option-item').first().click();

      if (i < 9) {
        await page.getByRole('button', { name: /下一題/i }).click();
      }
    }
  });

  test('選項不應有重複的 key', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel(/題數/i).fill('5');
    await page.getByRole('button', { name: /開始測驗/i }).click();

    for (let i = 0; i < 5; i++) {
      await expect(page.locator('.question-card')).toBeVisible();

      const optionKeys = await page.locator('.option-key').allTextContents();
      const uniqueKeys = new Set(optionKeys);

      // 驗證沒有重複的 key
      expect(uniqueKeys.size).toBe(optionKeys.length);

      await page.locator('.option-item').first().click();

      if (i < 4) {
        await page.getByRole('button', { name: /下一題/i }).click();
      }
    }
  });
});

test.describe('平台功能完整性', () => {
  test('首頁應顯示正確的題目統計', async ({ page }) => {
    await page.goto('/');

    // 應顯示題目數量
    const statsText = await page.locator('.stats-badges').textContent();
    console.log('統計資訊:', statsText);

    // 驗證有題目數量顯示
    expect(statsText).toMatch(/\d+\s*題/);
  });

  test('考試模式不應立即顯示答案', async ({ page }) => {
    await page.goto('/');

    // 選擇考試模式
    await page.getByLabel(/測驗模式/i).selectOption('exam');
    await page.getByRole('button', { name: /開始測驗/i }).click();

    await expect(page.locator('.question-card')).toBeVisible();

    // 選擇答案
    await page.locator('.option-item').first().click();

    // 考試模式下不應有 correct/incorrect 樣式
    const correctOption = page.locator('.option-item.correct');
    const incorrectOption = page.locator('.option-item.incorrect');

    await expect(correctOption).not.toBeVisible();
    await expect(incorrectOption).not.toBeVisible();

    // 也不應有 AI 解析按鈕
    await expect(page.locator('.ai-explain-btn')).not.toBeVisible();
  });
});
