// 設定頁面元件
import { useState } from 'react';
import type { useAccessibility } from '../hooks/useAccessibility';
import { usePracticeMode } from '../hooks/usePracticeMode';
import { usePracticePool } from '../hooks/usePracticePool';
import { PracticeOptInDialog } from '../components/PracticeOptInDialog/PracticeOptInDialog';
import { clearStats } from '../utils/question-stats-storage';
import packageJson from '../../package.json';
import './SettingsPage.css';

const APP_VERSION = packageJson.version;

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

  const practiceMode = usePracticeMode();
  const { pool } = usePracticePool();
  const [optInOpen, setOptInOpen] = useState(false);

  const onTogglePractice = () => {
    if (practiceMode.enabled) {
      practiceMode.disable();
    } else if (practiceMode.hasOptedIn) {
      practiceMode.enable();
    } else {
      setOptInOpen(true);
    }
  };

  return (
    <div className="settings-page animate-fade-in">
      <header className="settings-header">
        <h1>
          <span className="material-icons" aria-hidden="true">settings</span>
          設定
        </h1>
        {/*
          使用 visible text「返回首頁」當 accessible name（不加 aria-label）。
          若 aria-label 與 visible text 不一致，voice-control 使用者說 visible
          name 將無法觸發此元素 — WCAG 2.1 SC 2.5.3「Label in Name」(Level A)：
          https://www.w3.org/WAI/WCAG21/Understanding/label-in-name.html
          原本是 icon-only X button，使用者反映 #72 找不到返回入口。
        */}
        <button
          className="btn btn-secondary settings-back-btn"
          onClick={onClose}
        >
          <span className="material-icons" aria-hidden="true">arrow_back</span>
          返回首頁
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

      {/* 加強練習池 */}
      <section className="settings-section card">
        <h2>加強練習池</h2>
        <div className="setting-item">
          <div className="setting-info">
            <span className="material-icons">auto_awesome</span>
            <div>
              <p className="setting-title">啟用加強練習</p>
              <p className="setting-desc">
                {pool
                  ? `${pool._meta.totals.total} 題補充題（${pool._meta.totals.external_mock} 題模擬題、${pool._meta.totals.ai_generated} 題 AI 產題）；獨立於主題庫，每題附來源徽章。`
                  : '載入練習池中…'}
              </p>
            </div>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={practiceMode.enabled}
              onChange={onTogglePractice}
              aria-label="啟用加強練習池"
            />
            <span className="toggle-slider"></span>
          </label>
        </div>
      </section>

      <PracticeOptInDialog
        open={optInOpen}
        onAccept={() => {
          practiceMode.acceptOptIn();
          setOptInOpen(false);
        }}
        onDecline={() => setOptInOpen(false)}
      />

      {/* 作答統計（Refs #64）*/}
      <section className="settings-section card">
        <h2>作答統計</h2>
        <div className="setting-item">
          <div className="setting-info">
            <span className="material-icons">insights</span>
            <div>
              <p className="setting-title">清除作答統計</p>
              <p className="setting-desc">
                清除所有題目的累積答對率紀錄。資料僅儲存在本機（localStorage），不會上傳。
              </p>
            </div>
          </div>
          <button
            className="btn btn-secondary"
            onClick={() => {
              // 不可逆動作 — 用 native confirm 與 abort flow 一致地點對齊
              if (window.confirm('確定要清除所有作答統計嗎？此動作無法復原。')) {
                clearStats();
              }
            }}
          >
            <span className="material-icons" aria-hidden="true">delete_sweep</span>
            清除作答統計
          </button>
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
          <strong>淨零碳備考神器</strong> v{APP_VERSION}
        </p>
        <p>iPAS 淨零碳規劃管理師考古題練習工具</p>
        <p className="disclaimer">
          本工具題庫僅供練習參考。
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
