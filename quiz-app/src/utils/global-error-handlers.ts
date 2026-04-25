// 全域 error handlers — 補捕 React ErrorBoundary 抓不到的錯誤類型：
// - 非同步 setState / event handler 內 throw
// - Promise rejection 沒被 .catch
// - 第三方 script (puter.js / abacus / counterapi) 拋的 error
//
// 接到後一律 logger.error 上報，落入 ring buffer + console.error（DEV 直接顯示）。
import type { Logger } from './logger';

interface InstallOptions {
  logger: Logger;
  /** 是否真的呼叫 preventDefault 阻止 default browser logging？預設 false */
  preventBrowserDefault?: boolean;
}

interface InstalledHandlers {
  /** 解除掛載；測試 + HMR cleanup 用 */
  uninstall: () => void;
}

/**
 * 安裝 window 級全域 error handlers，把不會經過 React Error Boundary 的錯誤
 * 都上報到 logger。
 *
 * 同 logger 重複安裝是 idempotent — uninstall 後可再 install。
 *
 * @returns uninstall 函式
 */
export function installGlobalErrorHandlers(opts: InstallOptions): InstalledHandlers {
  const { logger, preventBrowserDefault = false } = opts;

  const onError = (event: ErrorEvent): void => {
    logger.error(
      'unhandled window error',
      event.error ?? new Error(event.message || 'unknown'),
      {
        source: event.filename,
        line: event.lineno,
        col: event.colno,
      },
    );
    if (preventBrowserDefault) event.preventDefault();
  };

  const onRejection = (event: PromiseRejectionEvent): void => {
    logger.error('unhandled promise rejection', event.reason);
    if (preventBrowserDefault) event.preventDefault();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
  }

  return {
    uninstall(): void {
      if (typeof window !== 'undefined') {
        window.removeEventListener('error', onError);
        window.removeEventListener('unhandledrejection', onRejection);
      }
    },
  };
}
