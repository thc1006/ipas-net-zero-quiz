// React Error Boundary — 抓住子元件 render error 並顯示 fallback UI
// React 18 沒有 hook 版的 boundary，class component 是唯一手段
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger as defaultLogger, type Logger } from '../../utils/logger';
import { BUG_REPORT_URL } from '../../data/app-meta';
import './ErrorBoundary.css';

interface Props {
  children: ReactNode;
  /** 注入用 logger（測試 / 重設）— 預設使用全域 singleton */
  logger?: Logger;
}

interface State {
  hasError: boolean;
  error: Error | null;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, showDetails: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const log = this.props.logger ?? defaultLogger;
    log.error('component render error', error, {
      componentStack: info.componentStack ?? '(no stack)',
    });
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, error: null, showDetails: false });
  };

  private toggleDetails = (): void => {
    this.setState((s) => ({ showDetails: !s.showDetails }));
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    const { error, showDetails } = this.state;
    return (
      <div className="error-boundary card" role="alert" aria-live="assertive">
        <div className="error-boundary__header">
          <span className="material-icons error-boundary__icon">error_outline</span>
          <h2 className="error-boundary__title">出錯了</h2>
        </div>
        <p className="error-boundary__message">
          頁面渲染時發生錯誤。請點選「重試」重新載入；若仍持續，
          請<a href={BUG_REPORT_URL} target="_blank" rel="noopener noreferrer">回報</a>給我們。
        </p>
        <div className="error-boundary__actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={this.handleRetry}
          >
            <span className="material-icons sm">refresh</span>
            重試
          </button>
          <button
            type="button"
            className="btn btn-text"
            onClick={this.toggleDetails}
            aria-expanded={showDetails}
          >
            {showDetails ? '隱藏詳情' : '顯示詳情'}
          </button>
        </div>
        {showDetails && error && (
          <details className="error-boundary__details" open>
            <summary className="error-boundary__details-summary">技術詳情</summary>
            <pre className="error-boundary__stack">
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ''}
            </pre>
          </details>
        )}
      </div>
    );
  }
}

export default ErrorBoundary;
