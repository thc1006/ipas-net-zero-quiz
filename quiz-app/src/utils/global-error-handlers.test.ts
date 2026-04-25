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
