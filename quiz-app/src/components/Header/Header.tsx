// Header 元件 - 頂部導覽列
import type { useAccessibility } from '../../hooks/useAccessibility';
import { DISCUSSIONS_URL, REPORT_URL } from '../../utils/feedback-url';
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

          {/* 回報問題（GitHub issue）與討論區（GitHub Discussions）分開；寬螢幕顯示字，窄螢幕只留圖示 */}
          <a
            href={REPORT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-text icon-btn header-link"
            aria-label="回報問題"
            title="回報問題"
          >
            <span className="material-icons" aria-hidden="true">bug_report</span>
            <span className="header-link-text">回報問題</span>
          </a>
          <a
            href={DISCUSSIONS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-text icon-btn header-link"
            aria-label="討論區"
            title="討論區"
          >
            <span className="material-icons" aria-hidden="true">forum</span>
            <span className="header-link-text">討論區</span>
          </a>
        </nav>
      </div>
    </header>
  );
}

export default Header;
