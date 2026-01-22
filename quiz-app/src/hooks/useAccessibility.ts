// 無障礙設定 Hook
import { useState, useEffect, useCallback } from 'react';
import type { AccessibilitySettings } from '../types/quiz';

const STORAGE_KEY = 'ipas-quiz-a11y';

/** 預設無障礙設定 */
const defaultSettings: AccessibilitySettings = {
  darkMode: false,
  highContrast: false,
  cvdMode: 'none',
  fontSize: 'normal',
};

/**
 * 從 localStorage 讀取設定
 */
function loadSettings(): AccessibilitySettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...defaultSettings, ...JSON.parse(stored) };
    }
  } catch {
    // 忽略解析錯誤
  }

  // 檢測系統深色模式偏好
  if (typeof window !== 'undefined') {
    const prefersDark = window.matchMedia(
      '(prefers-color-scheme: dark)'
    ).matches;
    return { ...defaultSettings, darkMode: prefersDark };
  }

  return defaultSettings;
}

/**
 * 儲存設定到 localStorage
 */
function saveSettings(settings: AccessibilitySettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 忽略儲存錯誤
  }
}

/**
 * 套用設定到 document
 */
function applySettings(settings: AccessibilitySettings): void {
  const { documentElement } = document;

  // 深色模式
  documentElement.setAttribute(
    'data-theme',
    settings.darkMode ? 'dark' : 'light'
  );

  // 高對比度
  documentElement.setAttribute(
    'data-high-contrast',
    settings.highContrast ? 'true' : 'false'
  );

  // CVD 模式
  documentElement.setAttribute('data-cvd-mode', settings.cvdMode);

  // 字體大小
  documentElement.setAttribute('data-font-size', settings.fontSize);
}

/**
 * 無障礙設定 Hook
 */
export function useAccessibility() {
  const [settings, setSettings] = useState<AccessibilitySettings>(loadSettings);

  // 初始化時套用設定（僅在首次載入時執行，後續由 updateSettings 處理）
  useEffect(() => {
    applySettings(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 更新設定
  const updateSettings = useCallback(
    (updates: Partial<AccessibilitySettings>) => {
      setSettings((prev) => {
        const newSettings = { ...prev, ...updates };
        saveSettings(newSettings);
        applySettings(newSettings);
        return newSettings;
      });
    },
    []
  );

  // 切換深色模式
  const toggleDarkMode = useCallback(() => {
    updateSettings({ darkMode: !settings.darkMode });
  }, [settings.darkMode, updateSettings]);

  // 切換高對比度
  const toggleHighContrast = useCallback(() => {
    updateSettings({ highContrast: !settings.highContrast });
  }, [settings.highContrast, updateSettings]);

  // 設定 CVD 模式
  const setCvdMode = useCallback(
    (mode: AccessibilitySettings['cvdMode']) => {
      updateSettings({ cvdMode: mode });
    },
    [updateSettings]
  );

  // 設定字體大小
  const setFontSize = useCallback(
    (size: AccessibilitySettings['fontSize']) => {
      updateSettings({ fontSize: size });
    },
    [updateSettings]
  );

  // 重置為預設
  const resetToDefault = useCallback(() => {
    const prefersDark = window.matchMedia(
      '(prefers-color-scheme: dark)'
    ).matches;
    updateSettings({ ...defaultSettings, darkMode: prefersDark });
  }, [updateSettings]);

  // 監聽系統主題變更
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      // 只有在使用者沒有手動設定時才跟隨系統
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        updateSettings({ darkMode: e.matches });
      }
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [updateSettings]);

  return {
    settings,
    updateSettings,
    toggleDarkMode,
    toggleHighContrast,
    setCvdMode,
    setFontSize,
    resetToDefault,
  };
}

export default useAccessibility;
