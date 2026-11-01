import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E 測試配置
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Firefox / WebKit 只跑跨瀏覽器 smoke，透過 testMatch 限制，不把整套 E2E 乘三：
    // settings-smoke.spec.ts（PR #108：自訂 <select> + 色覺模式）、official-mode.spec.ts
    // （#128：題目來源選單在手機寬度不能把頁面撐寬，選單的固有寬度各引擎不同）、
    // home-subtitle.spec.ts（首頁副標的斷行：各引擎開始換行的寬度不同）、
    // practice-keyboard.spec.ts（radio 的方向鍵與 Tab 落點各引擎不同）、
    // dialog-fit.spec.ts（對話框的高度各引擎不同）、
    // storage-blocked.spec.ts（封鎖網站資料時各引擎丟的例外不同）、
    // pool-load.spec.ts（chunk 載入失敗的處理）、
    // report-links.spec.ts（頁首的回報問題與討論區：字寬各引擎不同，窄螢幕不能把頁首撐寬）與
    // selected-option.spec.ts、similar-panel.spec.ts（#148：選取選項的顏色與記號、相似題那一區的框，各引擎畫出來的要一起看）。
    {
      name: 'firefox-smoke',
      use: { ...devices['Desktop Firefox'] },
      testMatch: /(settings-smoke|official-mode|practice-keyboard|dialog-fit|storage-blocked|pool-load|home-subtitle|report-links|selected-option|similar-panel)\.spec\.ts/,
    },
    {
      name: 'webkit-smoke',
      use: { ...devices['Desktop Safari'] },
      testMatch: /(settings-smoke|official-mode|practice-keyboard|dialog-fit|storage-blocked|pool-load|home-subtitle|report-links|selected-option|similar-panel)\.spec\.ts/,
    },
    // 行動裝置測試（如需可取消註解）
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
  ],

  // 本地開發時自動啟動預覽伺服器
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
