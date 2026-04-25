// 前端 Logger
//
// 設計原則：
// - DEV 模式（vite dev / vitest）：所有 level 都寫到 console
// - PROD 模式（vite build）：info/warn 靜默；error 仍 console.error 並寫入 ring buffer
// - 不送外部 service（避免 dep + 隱私問題）；如未來想加，hook getRecentErrors()
//
// Usage:
//   import { logger } from '../utils/logger';
//   logger.info('user clicked start');
//   logger.error('quiz load failed', err);
//
//   // settings 頁可顯示最近錯誤：
//   logger.getRecentErrors();

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
}

const LEVEL_RANK: Record<LogLevel, number> = { info: 0, warn: 1, error: 2 };

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

export class Logger {
  private readonly isDev: boolean;
  private readonly bufferSize: number;
  private readonly minLevel: LogLevel;
  private buffer: LogEntry[] = [];

  constructor(opts: LoggerOptions = {}) {
    // 在 vitest 環境也視為 dev — 預設讀 import.meta.env.DEV，但 vitest 把它設成 false
    this.isDev = opts.isDev ?? Boolean(import.meta.env?.DEV);
    this.bufferSize = opts.bufferSize ?? 20;
    this.minLevel = opts.level ?? (this.isDev ? 'info' : 'error');
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_RANK[level] >= LEVEL_RANK[this.minLevel];
  }

  private format(level: LogLevel, message: string): string {
    return `[${level.toUpperCase()}] ${message}`;
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog('info')) return;
    if (context !== undefined) {
      console.info(this.format('info', message), context);
    } else {
      console.info(this.format('info', message));
    }
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog('warn')) return;
    if (context !== undefined) {
      console.warn(this.format('warn', message), context);
    } else {
      console.warn(this.format('warn', message));
    }
  }

  error(message: string, err?: unknown, context?: Record<string, unknown>): void {
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
  }
}

// 全域單例 — App 各處 import 此實例
export const logger = new Logger();
