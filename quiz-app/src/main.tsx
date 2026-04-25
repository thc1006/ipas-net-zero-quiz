// 應用程式入口
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('找不到 root 元素');
}

// Dev 模式啟動時驗證練習池 schema — 失敗會 throw 醒目錯誤
// Production 模式不執行此驗證（節省 bundle / 啟動時間）
if (import.meta.env.DEV) {
  void Promise.all([
    import('./data/practice_pool.json'),
    import('./utils/practice-pool-schema'),
  ])
    .then(([poolModule, schemaModule]) => {
      schemaModule.assertPracticePoolValid(poolModule.default);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[startup] practice_pool schema validation failed:', err);
    });
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
