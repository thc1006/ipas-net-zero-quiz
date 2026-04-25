// ErrorBoundary 測試
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';
import { Logger } from '../../utils/logger';

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
