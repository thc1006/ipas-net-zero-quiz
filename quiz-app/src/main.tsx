// 應用程式入口
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';
import { assertPracticePoolValid } from './utils/practice-pool-schema';
import { assertMainBankValid } from './utils/main-bank-schema';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('找不到 root 元素');
}

// Dev 模式啟動時驗證 schema — 失敗以 unhandled rejection 浮現
// Production 模式：assertXxxValid 內 PROD guard 會降級為 warn，不 throw
// 用靜態 import 取得 asserts function（dynamic import 會丟失 asserts type）
if (import.meta.env.DEV) {
  void import('./data/practice_pool.json').then((m) => {
    assertPracticePoolValid(m.default);
  });
  void import('./data/integrated_dataset.json').then((m) => {
    assertMainBankValid(m.default);
  });
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
