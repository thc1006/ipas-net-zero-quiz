// Header 元件 — Carbon Ledger 版頂部導覽列
// 設計：左側為「碳足跡」logomark（CO₂ 圓 + 序號）+ Fraunces wordmark；
//      右側為功能列；社群討論用 forum icon（不再是章魚貓）
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
    <header className="app-header cl-header">
      <div className="header-container cl-header__container">
        {/* Logomark + wordmark */}
        <button className="header-logo cl-header__brand" onClick={onGoHome} aria-label="回首頁">
          <svg
            className="cl-header__mark"
            viewBox="0 0 36 36"
            width="36"
            height="36"
            aria-hidden="true"
          >
            {/* 雙圓：外圓代表大氣，內圓代表碳；缺口表示「淨零」差距正在被計量 */}
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3" />
            <circle cx="18" cy="18" r="11" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M 18 7 A 11 11 0 0 1 26.7 23.7"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
            {/* tabular CO₂ marker */}
            <text
              x="18"
              y="22.5"
              textAnchor="middle"
              fontSize="9.5"
              fontFamily="JetBrains Mono, monospace"
              fontWeight="600"
              fill="currentColor"
            >
              CO₂
            </text>
          </svg>
          <div className="logo-text cl-header__words">
            <span className="logo-title cl-header__title">淨零碳備考神器</span>
            <span className="logo-subtitle cl-header__subtitle cl-eyebrow">
              ARCHIVE / iPAS-NZ
            </span>
          </div>
        </button>

        {/* 功能按鈕 */}
        <nav className="header-actions cl-header__nav" aria-label="功能選單">
          <button
            className="btn btn-text icon-btn cl-header__icon-btn"
            onClick={toggleDarkMode}
            aria-label={settings.darkMode ? '切換淺色模式' : '切換深色模式'}
            title={settings.darkMode ? '淺色模式' : '深色模式'}
          >
            <span className="material-icons">
              {settings.darkMode ? 'light_mode' : 'dark_mode'}
            </span>
          </button>

          <button
            className="btn btn-text icon-btn cl-header__icon-btn"
            onClick={onOpenSettings}
            aria-label="開啟設定"
            title="設定"
          >
            <span className="material-icons">settings</span>
          </button>

          {/* 社群討論 / 回報題目 — 改用 forum icon 對齊意圖 */}
          <a
            href="https://github.com/thc1006/ipas-net-zero-quiz/discussions/1"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-text icon-btn cl-header__icon-btn"
            aria-label="社群討論 / 回報題目"
            title="社群討論"
          >
            <span className="material-icons">forum</span>
          </a>
        </nav>
      </div>
    </header>
  );
}

export default Header;
