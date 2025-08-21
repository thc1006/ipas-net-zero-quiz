import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  test: {
    // 全域測試配置
    globals: true,
    environment: 'jsdom',
    
    // 測試設定檔
    setupFiles: ['./tests/setup.js'],
    
    // 包含的測試檔案模式
    include: [
      'tests/**/*.{test,spec}.{js,ts,vue}',
      'src/**/*.{test,spec}.{js,ts,vue}'
    ],
    
    // 排除的檔案
    exclude: [
      'node_modules',
      'dist',
      'coverage',
      '.git',
      '.github',
      '**/*.d.ts'
    ],
    
    // 覆蓋率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      
      // 覆蓋率閾值
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        }
      },
      
      // 包含的檔案
      include: [
        'src/**/*.{js,ts,vue}',
        'src/components/**/*.vue',
        'src/composables/**/*.{js,ts}'
      ],
      
      // 排除的檔案
      exclude: [
        'src/main.js',
        'src/style.css',
        'src/assets/**',
        'src/types/**',
        '**/*.d.ts',
        '**/*.test.{js,ts,vue}',
        '**/*.spec.{js,ts,vue}',
        '**/node_modules/**',
        '**/dist/**',
        '**/coverage/**'
      ],
      
      // 排除未測試的檔案
      skipFull: false,
      
      // 覆蓋率報告設定
      watermarks: {
        statements: [50, 80],
        functions: [50, 80],
        branches: [50, 80],
        lines: [50, 80]
      }
    },
    
    // 測試執行設定
    testTimeout: 10000,
    hookTimeout: 10000,
    
    // 平行執行
    threads: true,
    maxThreads: 4,
    minThreads: 1,
    
    // 重試設定
    retry: 1,
    
    // 檔案監視設定
    watchExclude: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '**/*.log'
    ],
    
    // 報告器設定
    reporter: [
      'default',
      'json'
    ],
    
    // 輸出設定
    outputFile: {
      json: './coverage/test-results.json',
      html: './coverage/test-results.html'
    },
    
    // 更詳細的錯誤訊息
    hideSkippedTests: false,
    
    // 伺服器依賴設定
    server: {
      deps: {
        inline: ['vue']
      }
    },
    
    // 環境變數
    env: {
      NODE_ENV: 'test',
      VITE_APP_TITLE: 'iPAS Net Zero Quiz - Test Mode'
    }
  },
  
  // 解析設定
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '~': resolve(__dirname, 'tests')
    }
  },
  
  // 定義全域變數
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __APP_VERSION__: JSON.stringify('1.0.0-test'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString())
  }
})