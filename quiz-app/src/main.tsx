// 應用程式入口
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('找不到 root 元素');
}

// Dev 模式啟動時驗證練習池 schema — 失敗會以 unhandled rejection 浮現
// Production 模式不執行此驗證（節省 bundle / 啟動時間）
if (import.meta.env.DEV) {
  // 不加 .catch — 讓 schema 錯誤透過 unhandledrejection 在 DevTools 醒目顯示
  // (PR #22 assertPracticePoolValid 在 dev throw、production warn)
  void Promise.all([
    import('./data/practice_pool.json'),
    import('./utils/practice-pool-schema'),
  ]).then(([poolModule, schemaModule]) => {
    schemaModule.assertPracticePoolValid(poolModule.default);
  });
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
