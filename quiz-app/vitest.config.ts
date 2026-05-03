import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      // 注意：自訂 exclude 會「取代」vitest 預設的 exclude（不是 merge），
      // 所以必須把 build/lint config、E2E spec、type-only 宣告等明確列出，
      // 否則它們會被 v8 provider 偵測為 0% 拉低分母。
      // 此清單與 codecov.yml 的 ignore 同步維護。
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
      '@': resolve(__dirname, 'src'),
      '@components': resolve(__dirname, 'src/components'),
      '@data': resolve(__dirname, 'src/data'),
      '@hooks': resolve(__dirname, 'src/hooks'),
      '@types': resolve(__dirname, 'src/types'),
      '@utils': resolve(__dirname, 'src/utils'),
    },
  },
});
