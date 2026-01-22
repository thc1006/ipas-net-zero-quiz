// 設定頁面元件
import type { useAccessibility } from '../hooks/useAccessibility';
import './SettingsPage.css';

interface SettingsPageProps {
  accessibility: ReturnType<typeof useAccessibility>;
  onClose: () => void;
}

export function SettingsPage({ accessibility, onClose }: SettingsPageProps) {
  const {
    settings,
    toggleDarkMode,
    toggleHighContrast,
    setCvdMode,
    setFontSize,
    resetToDefault,
  } = accessibility;

  return (
    <div className="settings-page animate-fade-in">
      <header className="settings-header">
        <h1>
          <span className="material-icons">settings</span>
          設定
        </h1>
        <button className="btn btn-text" onClick={onClose} aria-label="關閉設定">
          <span className="material-icons">close</span>
        </button>
      </header>

      {/* 外觀設定 */}
      <section className="settings-section card">
        <h2>外觀</h2>

        <div className="setting-item">
          <div className="setting-info">
            <span className="material-icons">dark_mode</span>
            <div>
              <p className="setting-title">深色模式</p>
              <p className="setting-desc">減少眼睛疲勞，適合夜間使用</p>
            </div>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={settings.darkMode}
              onChange={toggleDarkMode}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <span className="material-icons">text_fields</span>
            <div>
              <p className="setting-title">字體大小</p>
              <p className="setting-desc">調整文字顯示大小</p>
            </div>
          </div>
          <select
            value={settings.fontSize}
            onChange={(e) =>
              setFontSize(e.target.value as 'normal' | 'large' | 'xlarge')
            }
          >
            <option value="normal">標準</option>
            <option value="large">大</option>
            <option value="xlarge">特大</option>
          </select>
        </div>
      </section>

      {/* 無障礙設定 */}
      <section className="settings-section card">
        <h2>
          <span className="material-icons">accessibility_new</span>
          無障礙
        </h2>

        <div className="setting-item">
          <div className="setting-info">
            <span className="material-icons">contrast</span>
            <div>
              <p className="setting-title">高對比度</p>
              <p className="setting-desc">增強文字與背景對比，提升可讀性</p>
            </div>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={settings.highContrast}
              onChange={toggleHighContrast}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <span className="material-icons">visibility</span>
            <div>
              <p className="setting-title">色覺辨認模式</p>
              <p className="setting-desc">針對色覺辨認障礙調整配色</p>
            </div>
          </div>
          <select
            value={settings.cvdMode}
            onChange={(e) =>
              setCvdMode(
                e.target.value as 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia'
              )
            }
          >
            <option value="none">無</option>
            <option value="protanopia">紅色盲 (Protanopia)</option>
            <option value="deuteranopia">綠色盲 (Deuteranopia)</option>
            <option value="tritanopia">藍色盲 (Tritanopia)</option>
          </select>
        </div>
      </section>

      {/* 重置 */}
      <section className="settings-section">
        <button className="btn btn-secondary" onClick={resetToDefault}>
          <span className="material-icons">restore</span>
          重置為預設值
        </button>
      </section>

      {/* 關於 */}
      <section className="settings-section card about-section">
        <h2>關於</h2>
        <p>
          <strong>淨零碳備考神器</strong> v1.0.0
        </p>
        <p>iPAS 淨零碳規劃管理師考古題練習工具</p>
        <p className="disclaimer">
          本工具題庫僅供練習參考，題目著作權屬原作者所有。
        </p>
        <div className="about-links">
          <a
            href="https://github.com/thc1006/ipas-net-zero-quiz"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="material-icons sm">code</span>
            GitHub 原始碼
          </a>
          <a
            href="https://github.com/thc1006/ipas-net-zero-quiz/discussions/1"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="material-icons sm">bug_report</span>
            問題回報
          </a>
        </div>
      </section>
    </div>
  );
}

export default SettingsPage;
