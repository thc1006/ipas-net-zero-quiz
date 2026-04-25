// global-error-handlers 測試
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installGlobalErrorHandlers } from './global-error-handlers';
import { Logger } from './logger';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('installGlobalErrorHandlers', () => {
  it('window error event 被路由到 logger.error', () => {
    const logger = new Logger({ isDev: true });
    const errSpy = vi.spyOn(logger, 'error');
    const { uninstall } = installGlobalErrorHandlers({ logger });

    const event = new ErrorEvent('error', {
      message: 'boom',
      filename: 'app.js',
      lineno: 42,
      colno: 7,
      error: new Error('boom'),
    });
    window.dispatchEvent(event);

    expect(errSpy).toHaveBeenCalledOnce();
    const [msg, err, ctx] = errSpy.mock.calls[0];
    expect(msg).toMatch(/unhandled window error/);
    expect((err as Error).message).toBe('boom');
    expect(ctx).toEqual({ source: 'app.js', line: 42, col: 7 });
    uninstall();
  });

  it('unhandledrejection event 被路由到 logger.error', () => {
    const logger = new Logger({ isDev: true });
    const errSpy = vi.spyOn(logger, 'error');
    const { uninstall } = installGlobalErrorHandlers({ logger });

    // jsdom 的 PromiseRejectionEvent 用 generic Event 模擬即可
    const event = new Event('unhandledrejection') as unknown as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: new Error('unhandled') });
    window.dispatchEvent(event);

    expect(errSpy).toHaveBeenCalledOnce();
    expect(errSpy.mock.calls[0][0]).toMatch(/unhandled promise rejection/);
    uninstall();
  });

  it('uninstall 後事件不再上報', () => {
    const logger = new Logger({ isDev: true });
    const errSpy = vi.spyOn(logger, 'error');
    const { uninstall } = installGlobalErrorHandlers({ logger });
    uninstall();

    window.dispatchEvent(new ErrorEvent('error', { message: 'after-uninstall' }));
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('preventBrowserDefault: true 時 event.preventDefault 被呼叫', () => {
    const logger = new Logger({ isDev: true });
    const { uninstall } = installGlobalErrorHandlers({
      logger,
      preventBrowserDefault: true,
    });

    const event = new ErrorEvent('error', { message: 'x', error: new Error('x') });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);
    expect(preventSpy).toHaveBeenCalled();
    uninstall();
  });

  it('預設不 preventDefault（不阻止 browser console 也印）', () => {
    const logger = new Logger({ isDev: true });
    const { uninstall } = installGlobalErrorHandlers({ logger });

    const event = new ErrorEvent('error', { message: 'x', error: new Error('x') });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);
    expect(preventSpy).not.toHaveBeenCalled();
    uninstall();
  });
});

describe('installGlobalErrorHandlers dedupe / burst protection', () => {
  it('1 秒內同訊息 6 次 → 第 6 次起 dedupe（不再 push 到 ring buffer）', () => {
    const logger = new Logger({ isDev: true });
    const errSpy = vi.spyOn(logger, 'error');
    const warnSpy = vi.spyOn(logger, 'warn');
    const { uninstall } = installGlobalErrorHandlers({
      logger,
      dedupeBurstThreshold: 5,
    });

    for (let i = 0; i < 8; i++) {
      window.dispatchEvent(new ErrorEvent('error', { message: 'loop-err' }));
    }
    // 前 5 次正常記，第 6 次起 dedupe
    expect(errSpy).toHaveBeenCalledTimes(5);
    // 跨 threshold 那次發 1 個 warn 'error burst muted'
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toMatch(/burst muted/);
    uninstall();
  });

  it('不同訊息分別計 — A 多次不會 mute B', () => {
    const logger = new Logger({ isDev: true });
    const errSpy = vi.spyOn(logger, 'error');
    const { uninstall } = installGlobalErrorHandlers({
      logger,
      dedupeBurstThreshold: 3,
    });

    for (let i = 0; i < 5; i++) {
      window.dispatchEvent(new ErrorEvent('error', { message: 'A' }));
    }
    window.dispatchEvent(new ErrorEvent('error', { message: 'B' }));
    expect(errSpy).toHaveBeenCalledTimes(4);
    uninstall();
  });

  it('dedupeBurstThreshold = 0 → 關閉 dedupe', () => {
    const logger = new Logger({ isDev: true });
    const errSpy = vi.spyOn(logger, 'error');
    const { uninstall } = installGlobalErrorHandlers({
      logger,
      dedupeBurstThreshold: 0,
    });
    for (let i = 0; i < 10; i++) {
      window.dispatchEvent(new ErrorEvent('error', { message: 'no-cap' }));
    }
    expect(errSpy).toHaveBeenCalledTimes(10);
    uninstall();
  });

  it('rejection burst 也 dedupe', () => {
    const logger = new Logger({ isDev: true });
    const errSpy = vi.spyOn(logger, 'error');
    const { uninstall } = installGlobalErrorHandlers({
      logger,
      dedupeBurstThreshold: 2,
    });
    for (let i = 0; i < 5; i++) {
      const ev = new Event('unhandledrejection') as unknown as PromiseRejectionEvent;
      Object.defineProperty(ev, 'reason', { value: new Error('rej-loop') });
      window.dispatchEvent(ev);
    }
    expect(errSpy).toHaveBeenCalledTimes(2);
    uninstall();
  });
});
