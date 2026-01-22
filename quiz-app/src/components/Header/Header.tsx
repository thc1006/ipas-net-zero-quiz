// Header 元件 - 頂部導覽列
import type { useAccessibility } from '../../hooks/useAccessibility';
import './Header.css';

interface HeaderProps {
  onOpenSettings: () => void;
  onGoHome: () => void;
  accessibility: ReturnType<typeof useAccessibility>;
}

export function Header({ onOpenSettings, onGoHome, accessibility }: HeaderProps) {
  const { settings, toggleDarkMode } = accessibility;

  return (
    <header className="app-header">
      <div className="header-container">
        {/* Logo / 標題 */}
        <button className="header-logo" onClick={onGoHome} aria-label="回首頁">
          <span className="material-icons lg">eco</span>
          <div className="logo-text">
            <span className="logo-title">淨零碳備考神器</span>
            <span className="logo-subtitle">iPAS 考古題練習</span>
          </div>
        </button>

        {/* 功能按鈕 */}
        <nav className="header-actions" aria-label="功能選單">
          {/* 深色模式切換 */}
          <button
            className="btn btn-text icon-btn"
            onClick={toggleDarkMode}
            aria-label={settings.darkMode ? '切換淺色模式' : '切換深色模式'}
            title={settings.darkMode ? '淺色模式' : '深色模式'}
          >
            <span className="material-icons">
              {settings.darkMode ? 'light_mode' : 'dark_mode'}
            </span>
          </button>

          {/* 設定 */}
          <button
            className="btn btn-text icon-btn"
            onClick={onOpenSettings}
            aria-label="開啟設定"
            title="設定"
          >
            <span className="material-icons">settings</span>
          </button>

          {/* GitHub 連結 */}
          <a
            href="https://github.com/thc1006/ipas-net-zero-quiz"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-text icon-btn"
            aria-label="GitHub 專案"
            title="GitHub"
          >
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
          </a>
        </nav>
      </div>
    </header>
  );
}

export default Header;
