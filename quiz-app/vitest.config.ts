import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
// 與正式 build 同一份 define 與 json 設定：單元測試看到的就是出貨的值。寫出副檔名：Vite 打算改成預設的
// configLoader: 'native' 用 Node 自己的 import，不會補副檔名（沒寫就是 ERR_MODULE_NOT_FOUND）
import { shared } from './vite.config.ts';

export default defineConfig({
  ...shared,
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      // 分母是 src 底下所有 .ts/.tsx，連測試從沒載入過的檔也算。
      // Vitest 4 拿掉了 coverage.all：不寫 include 就只報「測試期間載入過的檔」，
      // 沒被測到的新檔悄悄不進分母，還會混進被 import 的 .css 與 package.json。
      include: ['src/**/*.{ts,tsx}'],
      // 再從 include 裡剔除不該算的檔。此清單與 codecov.yml 的 ignore 同步維護；
      // 落在 include 之外的項目（config、tests/、dist/ 等）是為了與 codecov.yml 對齊才留著。
      exclude: [
        'node_modules/',
        'dist/',
        'coverage/',
        // Build / lint / test configs
        '**/*.config.{js,ts,mjs,cjs}',
        '**/eslint.config.{js,ts,mjs}',
        // E2E spec 走 Playwright，不該算 unit coverage
        'tests/**',
        // Test setup / 測試檔本身
        'src/test-setup.ts',
        '**/*.test.{ts,tsx}',
        // Entry point：bootstrap-only side effects；由 E2E 整合測試覆蓋
        'src/main.tsx',
        // 純 re-export barrel files（無邏輯，覆蓋率無意義）
        'src/**/index.ts',
        // Type-only 宣告
        'src/types/**',
        '**/*.d.ts',
        // 資料 fixtures
        'src/data/*.json',
        // 需要 puter.js + puter.ai.chat mock，屬整合測試範疇（codecov.yml 同步 ignore）
        'src/utils/ai-helper.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      '@components': resolve(import.meta.dirname, 'src/components'),
      '@data': resolve(import.meta.dirname, 'src/data'),
      '@hooks': resolve(import.meta.dirname, 'src/hooks'),
      '@types': resolve(import.meta.dirname, 'src/types'),
      '@utils': resolve(import.meta.dirname, 'src/utils'),
    },
  },
});
