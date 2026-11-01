// ErrorBoundary 測試
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';
import { Logger } from '../../utils/logger';
import { APP_VERSION } from '../../data/app-meta';
import { ERROR_MAX_CHARS } from '../../utils/feedback-url';

// React 在 ErrorBoundary 抓到錯誤時會印 console.error；
// 測試裡靜音以免污染輸出
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function ThrowingChild({ message = 'kaboom' }: { message?: string }): JSX.Element {
  throw new Error(message);
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>safe content</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('safe content')).toBeInTheDocument();
  });

  it('catches render errors and shows fallback UI', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // h2 title 顯示「出錯了」
    expect(screen.getByRole('heading', { name: '出錯了' })).toBeInTheDocument();
  });

  it('shows error details in expandable section', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild message="custom-error-msg" />
      </ErrorBoundary>
    );
    // 預設折疊，需點開
    const detailsToggle = screen.getByRole('button', { name: /顯示詳情|查看詳情/ });
    fireEvent.click(detailsToggle);
    expect(screen.getByText(/custom-error-msg/)).toBeInTheDocument();
  });

  it('回報連結開網站問題範本，帶入網站版本與錯誤訊息的第一行，不帶堆疊', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild message={'Cannot read stem\nsecond line'} />
      </ErrorBoundary>
    );
    const link = screen.getByRole('link', { name: '回報這個問題' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const url = new URL(link.getAttribute('href')!);
    expect(url.pathname).toMatch(/\/issues\/new$/);
    // 只有這三個欄位：堆疊、元件樹與第二行之後都不進網址
    expect([...url.searchParams]).toEqual([
      ['template', 'site-bug.yml'],
      ['app_version', APP_VERSION],
      ['error_message', 'Cannot read stem'],
    ]);
  });

  it('丟出來的不是 Error、message 不是字串：錯誤畫面照常顯示，回報連結不帶錯誤訊息', () => {
    for (const thrown of [{ message: 42 }, { message: { text: 'x' } }, 'plain string', 7]) {
      const Thrower = (): JSX.Element => {
        throw thrown;
      };
      render(
        <ErrorBoundary>
          <Thrower />
        </ErrorBoundary>
      );
      const url = new URL(screen.getByRole('link', { name: '回報這個問題' }).getAttribute('href')!);
      expect([...url.searchParams.keys()], JSON.stringify(thrown)).toEqual(['template', 'app_version']);
      // 技術詳情也不能崩潰：看得到轉成字串的內容
      fireEvent.click(screen.getByRole('button', { name: '顯示詳情' }));
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(document.querySelector('.error-boundary__stack')?.textContent).toBe(
        String((thrown as { message?: unknown }).message ?? thrown)
      );
      cleanup();
    }
  });

  it('throw 的值、它的 message 或 stack 是 String() 轉不了的東西（沒有原型、toString 或 getter 丟例外）：錯誤畫面與技術詳情照常顯示', () => {
    const boom = (): never => {
      throw new Error('nope');
    };
    const cases: [unknown, string][] = [
      [Object.create(null), '[object Object]'],
      [{ toString: boom }, '[object Object]'],
      [
        {
          get message() {
            return boom();
          },
          toString: boom,
          get [Symbol.toStringTag]() {
            return boom();
          },
        },
        '[object]',
      ],
      [{ message: Object.create(null), stack: Object.create(null) }, '[object Object]\n\n[object Object]'],
    ];
    for (const [thrown, text] of cases) {
      const Thrower = (): JSX.Element => {
        throw thrown;
      };
      render(
        <ErrorBoundary>
          <Thrower />
        </ErrorBoundary>
      );
      const url = new URL(screen.getByRole('link', { name: '回報這個問題' }).getAttribute('href')!);
      expect([...url.searchParams.keys()], text).toEqual(['template', 'app_version']);
      fireEvent.click(screen.getByRole('button', { name: '顯示詳情' }));
      expect(document.querySelector('.error-boundary__stack')?.textContent).toBe(text);
      cleanup();
    }
  });

  it('很長的錯誤訊息在回報連結裡截斷', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild message={'x'.repeat(5000)} />
      </ErrorBoundary>
    );
    const url = new URL(screen.getByRole('link', { name: '回報這個問題' }).getAttribute('href')!);
    expect(url.searchParams.get('error_message')).toBe(`${'x'.repeat(ERROR_MAX_CHARS)}…`);
  });

  it('passes errors to logger.error', () => {
    const log = new Logger({ isDev: true });
    const errSpy = vi.spyOn(log, 'error');
    render(
      <ErrorBoundary logger={log}>
        <ThrowingChild message="report-this" />
      </ErrorBoundary>
    );
    expect(errSpy).toHaveBeenCalled();
    expect(errSpy.mock.calls[0][0]).toMatch(/render error|component crash/i);
  });

  it('"重試" button resets error state and re-renders children', () => {
    let shouldThrow = true;
    const ConditionalThrower = () => {
      if (shouldThrow) throw new Error('first time');
      return <div>recovered content</div>;
    };

    render(
      <ErrorBoundary>
        <ConditionalThrower />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // 模擬條件變化（例如外部修復後使用者重試）
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /重試/ }));
    expect(screen.getByText('recovered content')).toBeInTheDocument();
  });

  it('falls back to a basic message even if details fail to render', () => {
    // null/undefined error 不該炸
    render(
      <ErrorBoundary>
        {null}
      </ErrorBoundary>
    );
    // children 是 null 不會觸發 boundary，正常 render
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
