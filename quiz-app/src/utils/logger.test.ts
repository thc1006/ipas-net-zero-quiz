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

  describe('serializeError edge cases', () => {
    it('handles plain string err (not Error instance)', () => {
      const log = new Logger({ isDev: false });
      log.error('msg', 'string err');
      expect(log.getRecentErrors()[0].error).toBe('string err');
    });

    it('handles plain object err via JSON.stringify', () => {
      const log = new Logger({ isDev: false });
      log.error('msg', { code: 'E_FAIL', detail: 42 });
      expect(log.getRecentErrors()[0].error).toBe('{"code":"E_FAIL","detail":42}');
    });

    it('handles circular object err (JSON.stringify throws → String fallback)', () => {
      const log = new Logger({ isDev: false });
      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;
      log.error('msg', circular);
      expect(log.getRecentErrors()[0].error).toBe('[object Object]');
    });

    it('handles undefined err (no error param)', () => {
      const log = new Logger({ isDev: false });
      log.error('just a message');
      expect(log.getRecentErrors()[0].error).toBeUndefined();
    });

    it('handles null err', () => {
      const log = new Logger({ isDev: false });
      log.error('msg', null);
      expect(log.getRecentErrors()[0].error).toBeUndefined();
    });

    it('Error without stack falls back to "Name: message" format', () => {
      const log = new Logger({ isDev: false });
      const err = new Error('no stack here');
      Object.defineProperty(err, 'stack', { value: undefined });
      log.error('msg', err);
      expect(log.getRecentErrors()[0].error).toBe('Error: no stack here');
    });
  });

  describe('warn / info / error context arg handling', () => {
    it('warn without context calls console.warn with single arg', () => {
      const log = new Logger({ isDev: true });
      log.warn('plain warning');
      expect(consoleWarnSpy.mock.calls[0]).toHaveLength(1);
    });

    it('warn with context calls console.warn with two args', () => {
      const log = new Logger({ isDev: true });
      log.warn('with ctx', { user: 'a' });
      expect(consoleWarnSpy.mock.calls[0]).toHaveLength(2);
    });

    it('info without context calls console.info with single arg', () => {
      const log = new Logger({ isDev: true });
      log.info('plain info');
      expect(consoleInfoSpy.mock.calls[0]).toHaveLength(1);
    });

    it('error with context only (no err) passes context as last arg', () => {
      const log = new Logger({ isDev: true });
      log.error('msg', undefined, { user: 'a' });
      // args: [formatted_msg, context]
      expect(consoleErrorSpy.mock.calls[0]).toHaveLength(2);
      expect(consoleErrorSpy.mock.calls[0][1]).toEqual({ user: 'a' });
    });
  });

  describe('default constructor (no opts)', () => {
    it('defaults isDev from import.meta.env.DEV (vitest === true)', () => {
      const log = new Logger();
      log.info('shown in dev');
      expect(consoleInfoSpy).toHaveBeenCalledOnce();
    });

    it('PROD mode error path: skips console output but still buffers', () => {
      // 強制 shouldLog 走 false 分支但仍 push 到 buffer
      const log = new Logger({ isDev: false, level: 'info' /* 不會被觸發 */ });
      // 用 minLevel='info' 但 isDev=false → 不影響 error path（error level 一定 push）
      log.error('production-error', new Error('boom'));
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(log.getRecentErrors()).toHaveLength(1);
    });
  });
});

describe('Logger persistence (persistKey)', () => {
  // 還原真實 localStorage（test-setup mock 是 vi.fn）
  function installRealLocalStorage() {
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
        clear: () => { store.clear(); },
        key: (i: number) => Array.from(store.keys())[i] ?? null,
        get length() { return store.size; },
      },
      writable: true,
      configurable: true,
    });
  }

  beforeEach(() => {
    installRealLocalStorage();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('persists ring buffer to localStorage on error()', () => {
    const log = new Logger({ isDev: false, persistKey: 'test-log' });
    log.error('boom', new Error('details'));
    const stored = localStorage.getItem('test-log');
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].message).toBe('boom');
  });

  it('restores buffer from localStorage on construct', () => {
    // 先寫一筆假資料
    const seed = [
      { level: 'error', message: 'old-error', timestamp: 123, error: 'stack' },
    ];
    localStorage.setItem('test-log', JSON.stringify(seed));
    const log = new Logger({ isDev: false, persistKey: 'test-log' });
    expect(log.getRecentErrors()).toHaveLength(1);
    expect(log.getRecentErrors()[0].message).toBe('old-error');
  });

  it('handles malformed localStorage (non-JSON / non-array) gracefully', () => {
    localStorage.setItem('test-log', 'not-json{{{');
    expect(
      () => new Logger({ isDev: false, persistKey: 'test-log' }),
    ).not.toThrow();
    const log = new Logger({ isDev: false, persistKey: 'test-log' });
    expect(log.getRecentErrors()).toEqual([]);
  });

  it('clearRecentErrors removes localStorage entry too', () => {
    const log = new Logger({ isDev: false, persistKey: 'test-log' });
    log.error('boom');
    log.clearRecentErrors();
    expect(localStorage.getItem('test-log')).toBeNull();
  });

  it('without persistKey: does NOT touch localStorage', () => {
    const log = new Logger({ isDev: false });
    log.error('boom');
    expect(localStorage.getItem('app-error-log')).toBeNull();
  });

  it('respects bufferSize when restoring (truncate to last N)', () => {
    const seed = Array.from({ length: 10 }, (_, i) => ({
      level: 'error',
      message: `e${i}`,
      timestamp: i,
    }));
    localStorage.setItem('test-log', JSON.stringify(seed));
    const log = new Logger({ isDev: false, persistKey: 'test-log', bufferSize: 3 });
    expect(log.getRecentErrors()).toHaveLength(3);
    expect(log.getRecentErrors()[0].message).toBe('e7');
  });
});

describe('Logger persist sanitizer (PII redaction)', () => {
  function installRealLocalStorage() {
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
        clear: () => { store.clear(); },
        key: (i: number) => Array.from(store.keys())[i] ?? null,
        get length() { return store.size; },
      },
      writable: true,
      configurable: true,
    });
  }
  beforeEach(() => { installRealLocalStorage(); });
  afterEach(() => { localStorage.clear(); });

  it('redacts password / token / email in context before persist', () => {
    const log = new Logger({ isDev: false, persistKey: 'pii-log' });
    log.error('login failed', new Error('bad creds'), {
      userEmail: 'a@b.com',
      apiToken: 'sk-xyz',
      sessionId: 'abc',
      quizId: '123',
    });
    const stored = JSON.parse(localStorage.getItem('pii-log')!);
    expect(stored[0].context.userEmail).toBe('[redacted]');
    expect(stored[0].context.apiToken).toBe('[redacted]');
    expect(stored[0].context.sessionId).toBe('[redacted]');
    // 非 PII key 保留原值
    expect(stored[0].context.quizId).toBe('123');
  });

  it('redacts nested objects recursively', () => {
    const log = new Logger({ isDev: false, persistKey: 'pii-log' });
    log.error('nested', undefined, {
      payload: { auth: 'bearer xxx', other: 'safe' },
    });
    const stored = JSON.parse(localStorage.getItem('pii-log')!);
    expect(stored[0].context.payload.auth).toBe('[redacted]');
    expect(stored[0].context.payload.other).toBe('safe');
  });

  it('in-memory buffer stays unredacted (DEV debug 仍可看到原 value)', () => {
    const log = new Logger({ isDev: true, persistKey: 'pii-log' });
    log.error('msg', undefined, { password: 'p1' });
    // In-memory unredacted
    expect(log.getRecentErrors()[0].context?.password).toBe('p1');
    // localStorage redacted
    const stored = JSON.parse(localStorage.getItem('pii-log')!);
    expect(stored[0].context.password).toBe('[redacted]');
  });

  it('handles arrays in context', () => {
    const log = new Logger({ isDev: false, persistKey: 'pii-log' });
    log.error('msg', undefined, {
      tokens: ['t1', 't2'],  // key matches /token/i → entire value redacted
      users: [{ email: 'a@b' }, { email: 'c@d' }],
    });
    const stored = JSON.parse(localStorage.getItem('pii-log')!);
    expect(stored[0].context.tokens).toBe('[redacted]');
    expect(stored[0].context.users[0].email).toBe('[redacted]');
  });

  it('Chinese 身分證 key also redacted', () => {
    const log = new Logger({ isDev: false, persistKey: 'pii-log' });
    log.error('msg', undefined, { 身分證: 'A123456789' });
    const stored = JSON.parse(localStorage.getItem('pii-log')!);
    expect(stored[0].context.身分證).toBe('[redacted]');
  });
});
