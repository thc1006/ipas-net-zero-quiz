// 加強練習模式狀態：以 localStorage 持久化是否啟用、是否已 opt-in 揭露
// 依 EU AI Act Art.50（2026-08-02 起）：使用 AI 產題前須揭露給使用者
import { useCallback, useEffect, useState } from 'react';

const ENABLED_KEY = 'practice-pool-enabled';
const OPTED_IN_KEY = 'practice-pool-ai-opt-in';

function readBool(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeBool(key: string, value: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* quota or disabled — silently ignore */
  }
}

export interface UsePracticeModeResult {
  /** 使用者是否啟用加強練習池 */
  enabled: boolean;
  /** 使用者是否已確認 AI 產題揭露聲明 */
  hasOptedIn: boolean;
  /** 啟用時須先 opt-in；若尚未 opt-in 則需先呼 acceptOptIn */
  enable: () => void;
  /** 關閉加強練習 */
  disable: () => void;
  /** 確認 AI 揭露聲明（同步觸發 enable） */
  acceptOptIn: () => void;
  /** 重置 opt-in（之後啟用時會再彈一次揭露） */
  resetOptIn: () => void;
}

export function usePracticeMode(): UsePracticeModeResult {
  const [enabled, setEnabled] = useState<boolean>(() => readBool(ENABLED_KEY));
  const [hasOptedIn, setHasOptedIn] = useState<boolean>(() => readBool(OPTED_IN_KEY));

  // sync if storage changes from another tab
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === ENABLED_KEY) setEnabled(readBool(ENABLED_KEY));
      if (e.key === OPTED_IN_KEY) setHasOptedIn(readBool(OPTED_IN_KEY));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const enable = useCallback(() => {
    setEnabled(true);
    writeBool(ENABLED_KEY, true);
  }, []);

  const disable = useCallback(() => {
    setEnabled(false);
    writeBool(ENABLED_KEY, false);
  }, []);

  const acceptOptIn = useCallback(() => {
    setHasOptedIn(true);
    writeBool(OPTED_IN_KEY, true);
    setEnabled(true);
    writeBool(ENABLED_KEY, true);
  }, []);

  const resetOptIn = useCallback(() => {
    setHasOptedIn(false);
    writeBool(OPTED_IN_KEY, false);
  }, []);

  return { enabled, hasOptedIn, enable, disable, acceptOptIn, resetOptIn };
}
