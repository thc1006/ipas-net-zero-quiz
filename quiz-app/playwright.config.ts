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
    // settings-smoke.spec.ts（PR #108：自訂 <select> + 色覺模式）與 official-mode.spec.ts
    // （#128：題目來源選單在手機寬度不能把頁面撐寬，選單的固有寬度各引擎不同）。
    {
      name: 'firefox-smoke',
      use: { ...devices['Desktop Firefox'] },
      testMatch: /(settings-smoke|official-mode)\.spec\.ts/,
    },
    {
      name: 'webkit-smoke',
      use: { ...devices['Desktop Safari'] },
      testMatch: /(settings-smoke|official-mode)\.spec\.ts/,
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
