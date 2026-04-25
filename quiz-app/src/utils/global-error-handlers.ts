// 全域 error handlers — 補捕 React ErrorBoundary 抓不到的錯誤類型：
// - 非同步 setState / event handler 內 throw
// - Promise rejection 沒被 .catch
// - 第三方 script (puter.js / abacus / counterapi) 拋的 error
//
// 接到後一律 logger.error 上報，落入 ring buffer + console.error（DEV 直接顯示）。
//
// 對 error loop（setInterval 內 throw 等）有保護：
// - 1 秒 sliding window 內超過 N 次同訊息 → 之後 dedupe 不再記
// - 讓 ring buffer 不被同一錯誤填滿
import type { Logger } from './logger';

interface InstallOptions {
  logger: Logger;
  /** 是否真的呼叫 preventDefault 阻止 default browser logging？預設 false */
  preventBrowserDefault?: boolean;
  /**
   * 1 秒內同訊息超過此次數則 dedupe（之後改寫 logger.warn 一筆 summary）。
   * 預設 5。0 = 關閉 dedupe。
   */
  dedupeBurstThreshold?: number;
}

interface InstalledHandlers {
  /** 解除掛載；測試 + HMR cleanup 用 */
  uninstall: () => void;
}

const DEDUPE_WINDOW_MS = 1000;

/**
 * 安裝 window 級全域 error handlers，把不會經過 React Error Boundary 的錯誤
 * 都上報到 logger。
 *
 * 同 logger 重複安裝是 idempotent — uninstall 後可再 install。
 *
 * @returns uninstall 函式
 */
export function installGlobalErrorHandlers(opts: InstallOptions): InstalledHandlers {
  const { logger, preventBrowserDefault = false, dedupeBurstThreshold = 5 } = opts;

  // sliding-window counter: messageKey -> { firstAt, count, mutedUntil }
  const seen = new Map<
    string,
    { firstAt: number; count: number; mutedUntil: number }
  >();

  function shouldDedupe(key: string): { dedupe: boolean; firstMute: boolean } {
    if (dedupeBurstThreshold <= 0) return { dedupe: false, firstMute: false };
    const now = Date.now();
    const rec = seen.get(key);

    // window 過了 → 重新計
    if (!rec || now - rec.firstAt > DEDUPE_WINDOW_MS) {
      seen.set(key, { firstAt: now, count: 1, mutedUntil: 0 });
      return { dedupe: false, firstMute: false };
    }

    // mute 還在效期內
    if (rec.mutedUntil > now) {
      rec.count += 1;
      return { dedupe: true, firstMute: false };
    }

    rec.count += 1;
    if (rec.count > dedupeBurstThreshold) {
      // 跨過 threshold — 進入 mute window
      rec.mutedUntil = now + DEDUPE_WINDOW_MS;
      return { dedupe: true, firstMute: true };
    }
    return { dedupe: false, firstMute: false };
  }

  const onError = (event: ErrorEvent): void => {
    const key = `error:${event.message ?? event.filename ?? 'unknown'}`;
    const { dedupe, firstMute } = shouldDedupe(key);
    if (dedupe) {
      if (firstMute) {
        logger.warn('error burst muted', {
          message: event.message,
          windowMs: DEDUPE_WINDOW_MS,
        });
      }
      // muted — 不再 push 到 ring buffer
      if (preventBrowserDefault) event.preventDefault();
      return;
    }

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
    const reason = event.reason;
    const reasonMsg =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : String(reason);
    const key = `rejection:${reasonMsg}`;
    const { dedupe, firstMute } = shouldDedupe(key);
    if (dedupe) {
      if (firstMute) {
        logger.warn('rejection burst muted', {
          reason: reasonMsg,
          windowMs: DEDUPE_WINDOW_MS,
        });
      }
      if (preventBrowserDefault) event.preventDefault();
      return;
    }

    logger.error('unhandled promise rejection', reason);
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
      seen.clear();
    },
  };
}
