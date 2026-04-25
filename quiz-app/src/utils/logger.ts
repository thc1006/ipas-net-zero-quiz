// 前端 Logger
//
// 設計原則：
// - DEV 模式（vite dev / vitest）：所有 level 都寫到 console
// - PROD 模式（vite build）：info/warn 靜默；error 仍 console.error 並寫入 ring buffer
// - 不送外部 service（避免 dep + 隱私問題）；如未來想加，hook getRecentErrors()
// - Ring buffer 可選擇性持久化到 localStorage（survive page reload）
//
// Usage:
//   import { logger } from '../utils/logger';
//   logger.info('user clicked start', { user: 'a' });
//   logger.error('quiz load failed', err);                   // err 是 Error 物件
//   logger.error('quiz load failed', err, { user: 'a' });    // 加 context
//   logger.error('plain message');                            // 沒 err，無 context
//
//   // settings 頁可顯示最近錯誤：
//   logger.getRecentErrors();
import { readBool } from './local-storage';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  /** 序列化後的 error（含 stack）— Error 物件不適合直接序列化到 localStorage */
  error?: string;
  context?: Record<string, unknown>;
  timestamp: number;
}

interface LoggerOptions {
  /** 預設讀 import.meta.env.DEV；test 可注入 */
  isDev?: boolean;
  /** Ring buffer 大小，預設 20 */
  bufferSize?: number;
  /** 最低 log level，預設 isDev ? 'info' : 'error' */
  level?: LogLevel;
  /**
   * 若提供 key，ring buffer 會持久化到 localStorage[key]，並在 constructor
   * 從中還原 — 讓 production 可在 reload 後仍看到上次崩潰的 error。
   * 預設 undefined（純 in-memory）。
   *
   * 持久化前會自動 sanitize PII-looking keys（email/password/token/auth/...）
   * 把 value 改成 `'[redacted]'`，避免 logger 不慎洩漏使用者個資。
   */
  persistKey?: string;
}

const LEVEL_RANK: Record<LogLevel, number> = { info: 0, warn: 1, error: 2 };

/** 序列化 size 上限（bytes）— 防 localStorage quota；超過會 reset buffer */
const PERSIST_MAX_BYTES = 32 * 1024;

/** 持久化前 redact 的 key 模式（不分大小寫，整個 key 配對 substring） */
const PII_KEY_PATTERNS = [
  /password/i,
  /passwd/i,
  /token/i,
  /auth/i,
  /secret/i,
  /api[_-]?key/i,
  /credential/i,
  /session/i,
  /cookie/i,
  /email/i,
  /phone/i,
  /ssn/i,
  /身分證|身份證/,
  /credit[_-]?card/i,
];

function isPiiKey(key: string): boolean {
  return PII_KEY_PATTERNS.some((re) => re.test(key));
}

/** 遞迴 sanitize：把 PII-looking key 的 value 改成 '[redacted]' */
function sanitizeForPersist(input: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]'; // 防深度循環
  if (input === null || typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.map((v) => sanitizeForPersist(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = isPiiKey(k) ? '[redacted]' : sanitizeForPersist(v, depth + 1);
  }
  return out;
}

function serializeError(err: unknown): string | undefined {
  if (err === undefined || err === null) return undefined;
  if (err instanceof Error) {
    return err.stack ?? `${err.name}: ${err.message}`;
  }
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function safeReadPersisted(key: string): LogEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // shape-validate：每筆要有 timestamp + level + message
    return parsed.filter(
      (e: unknown): e is LogEntry =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as LogEntry).timestamp === 'number' &&
        typeof (e as LogEntry).level === 'string' &&
        typeof (e as LogEntry).message === 'string',
    );
  } catch {
    return [];
  }
}

function safeWritePersisted(key: string, entries: LogEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    const json = JSON.stringify(entries);
    if (json.length > PERSIST_MAX_BYTES) {
      // 太大 → 縮成只留最近一筆（避免 quota error 又保留最新崩潰）
      const trimmed = entries.slice(-1);
      window.localStorage.setItem(key, JSON.stringify(trimmed));
      return;
    }
    window.localStorage.setItem(key, json);
  } catch {
    /* quota / disabled — silently ignore */
  }
}

export class Logger {
  private readonly isDev: boolean;
  private readonly bufferSize: number;
  private readonly minLevel: LogLevel;
  private readonly persistKey: string | undefined;
  private buffer: LogEntry[] = [];

  constructor(opts: LoggerOptions = {}) {
    // 在 vitest 環境也視為 dev — 預設讀 import.meta.env.DEV，但 vitest 把它設成 false
    this.isDev = opts.isDev ?? Boolean(import.meta.env?.DEV);
    this.bufferSize = opts.bufferSize ?? 20;
    this.minLevel = opts.level ?? (this.isDev ? 'info' : 'error');
    this.persistKey = opts.persistKey;

    if (this.persistKey) {
      this.buffer = safeReadPersisted(this.persistKey).slice(-this.bufferSize);
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_RANK[level] >= LEVEL_RANK[this.minLevel];
  }

  private format(level: LogLevel, message: string): string {
    return `[${level.toUpperCase()}] ${message}`;
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog('info')) return;
    const args: unknown[] = [this.format('info', message)];
    if (context !== undefined) args.push(context);
    console.info(...args);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog('warn')) return;
    const args: unknown[] = [this.format('warn', message)];
    if (context !== undefined) args.push(context);
    console.warn(...args);
  }

  /**
   * 記錄錯誤。
   *
   * 為什麼跟 info/warn 簽名不對稱：error 通常會帶 Error 物件（含 stack），
   * 邏輯不同於 info/warn 純 context；保留 `err` 參數允許 stack 序列化到
   * ring buffer。
   *
   * @param message 主訊息
   * @param err 通常是 Error 或 catch-block 的 unknown；無錯誤時傳 undefined
   * @param context 額外 metadata（user/url/feature flags 等）
   *
   * @example
   *   logger.error('AI 請求失敗', err);
   *   logger.error('Quiz state lost', err, { quizId: '123', step: 5 });
   *   logger.error('plain message');  // 沒 err 物件
   *
   * @警告 不要把 context 當 err 傳：`logger.error('msg', { user: 'a' })`
   *      會把 context 當 err 序列化（會印 '{"user":"a"}' 而非當 metadata）。
   *      若無 err，請明確傳 undefined：`logger.error('msg', undefined, ctx)`。
   */
  error(
    message: string,
    err?: Error | unknown,
    context?: Record<string, unknown>,
  ): void {
    // error 必寫 buffer 不論 level（讓 production 也能事後查 in-app debug）
    const entry: LogEntry = {
      level: 'error',
      message,
      error: serializeError(err),
      context,
      timestamp: Date.now(),
    };
    this.buffer.push(entry);
    if (this.buffer.length > this.bufferSize) {
      this.buffer.splice(0, this.buffer.length - this.bufferSize);
    }

    if (this.persistKey) {
      // 持久化前 sanitize：避免 context 中的 PII (email/token/etc) 落地 localStorage
      const sanitized = this.buffer.map((e) => ({
        ...e,
        context:
          e.context === undefined
            ? undefined
            : (sanitizeForPersist(e.context) as Record<string, unknown>),
      }));
      safeWritePersisted(this.persistKey, sanitized);
    }

    if (!this.shouldLog('error')) return;
    const args: unknown[] = [this.format('error', message)];
    if (err !== undefined) args.push(err);
    if (context !== undefined) args.push(context);
    console.error(...args);
  }

  /** 取最近 buffer 內錯誤（依時序）— 給 in-app debug section 用 */
  getRecentErrors(): readonly LogEntry[] {
    return [...this.buffer];
  }

  clearRecentErrors(): void {
    this.buffer = [];
    if (this.persistKey && typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(this.persistKey);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * 全域單例 — App 各處 import 此實例。
 * 預設用 persistKey 'app-error-log'，讓使用者重整頁面後仍可在 settings
 * 看到上次崩潰的錯誤。
 *
 * `readBool` import 是為了未來允許 user 透過 setting toggle 關閉 persistence；
 * 目前 always on。
 */
const PERSIST_DISABLED_KEY = 'logger-persist-disabled';
export const logger = new Logger({
  persistKey: readBool(PERSIST_DISABLED_KEY) ? undefined : 'app-error-log',
});
