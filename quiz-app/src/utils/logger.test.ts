// logger 測試
//
// 設計目標：
// - DEV 模式：寫到 console（含 level prefix）
// - PROD 模式：info/warn 靜默；error 仍 console.error 並寫入 ring buffer
// - Ring buffer：保留最近 N 筆 error 供 in-app debug section 顯示
// - 不送外部 service（避免新依賴 + 隱私）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from './logger';

describe('Logger', () => {
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('DEV mode (default level=info)', () => {
    it('logs info messages with level prefix', () => {
      const log = new Logger({ isDev: true });
      log.info('hello', { user: 'a' });
      expect(consoleInfoSpy).toHaveBeenCalledOnce();
      const [first] = consoleInfoSpy.mock.calls[0];
      expect(first).toMatch(/\[INFO\]/);
      expect(first).toContain('hello');
    });

    it('logs warn messages', () => {
      const log = new Logger({ isDev: true });
      log.warn('careful');
      expect(consoleWarnSpy).toHaveBeenCalledOnce();
      expect(consoleWarnSpy.mock.calls[0][0]).toMatch(/\[WARN\]/);
    });

    it('logs error messages', () => {
      const log = new Logger({ isDev: true });
      log.error('boom', new Error('details'));
      expect(consoleErrorSpy).toHaveBeenCalledOnce();
      expect(consoleErrorSpy.mock.calls[0][0]).toMatch(/\[ERROR\]/);
    });
  });

  describe('PROD mode (info/warn silenced; error kept)', () => {
    it('silences info', () => {
      const log = new Logger({ isDev: false });
      log.info('hidden');
      expect(consoleInfoSpy).not.toHaveBeenCalled();
    });

    it('silences warn', () => {
      const log = new Logger({ isDev: false });
      log.warn('hidden');
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('still logs error in PROD (visibility for production issues)', () => {
      const log = new Logger({ isDev: false });
      log.error('production failure');
      expect(consoleErrorSpy).toHaveBeenCalledOnce();
    });
  });

  describe('Ring buffer (recent errors)', () => {
    it('stores up to bufferSize entries (default 20)', () => {
      const log = new Logger({ isDev: false, bufferSize: 3 });
      log.error('e1');
      log.error('e2');
      log.error('e3');
      log.error('e4');
      const recent = log.getRecentErrors();
      expect(recent).toHaveLength(3);
      expect(recent[0].message).toBe('e2');
      expect(recent[2].message).toBe('e4');
    });

    it('captures timestamp + serializes Error stack', () => {
      const log = new Logger({ isDev: false });
      const err = new Error('with stack');
      log.error('boom', err);
      const recent = log.getRecentErrors();
      expect(recent).toHaveLength(1);
      expect(recent[0].message).toBe('boom');
      expect(recent[0].timestamp).toBeTypeOf('number');
      expect(recent[0].error).toContain('with stack');
    });

    it('clears buffer via clearRecentErrors()', () => {
      const log = new Logger({ isDev: false });
      log.error('e1');
      log.clearRecentErrors();
      expect(log.getRecentErrors()).toEqual([]);
    });

    it('does not buffer info / warn (only error)', () => {
      const log = new Logger({ isDev: true });
      log.info('a');
      log.warn('b');
      expect(log.getRecentErrors()).toEqual([]);
    });
  });

  describe('Custom level threshold', () => {
    it('with level=warn, info silenced but warn/error pass', () => {
      const log = new Logger({ isDev: true, level: 'warn' });
      log.info('hidden');
      log.warn('shown');
      log.error('shown');
      expect(consoleInfoSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledOnce();
      expect(consoleErrorSpy).toHaveBeenCalledOnce();
    });
  });
});
