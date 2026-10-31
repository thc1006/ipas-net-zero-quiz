// 加強練習模式狀態：以 localStorage 持久化是否啟用、是否已 opt-in 揭露
// 依 EU AI Act Art.50（2026-08-02 起）：使用 AI 產題前須揭露給使用者
import { useSyncExternalStore } from 'react';
import { readBool, writeBool } from '../utils/local-storage';

const ENABLED_KEY = 'practice-pool-enabled';
const OPTED_IN_KEY = 'practice-pool-ai-opt-in';

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

// App、HomePage、SettingsPage 各呼叫一次這個 hook，要看到同一個值：App 依它決定混不混練習池，按鈕在頁面上。
// storage 事件不會在寫入的分頁觸發，所以同一個分頁的變動由這裡通知每一個訂閱者。
const listeners = new Set<() => void>();
// 寫不進 localStorage 的值（私密模式、額度用完）：沒有這一份，按了啟用也不會生效
const unsaved = new Map<string, boolean>();

const read = (key: string): boolean => unsaved.get(key) ?? readBool(key);
const readEnabled = (): boolean => read(ENABLED_KEY);
const readHasOptedIn = (): boolean => read(OPTED_IN_KEY);

function write(key: string, value: boolean): void {
  writeBool(key, value);
  if (readBool(key) === value) unsaved.delete(key);
  else unsaved.set(key, value);
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  // sync if storage changes from another tab
  const onStorage = (e: StorageEvent) => {
    // e.key === null：另一 tab 呼叫 localStorage.clear()
    if (e.key === null) unsaved.clear();
    else unsaved.delete(e.key);
    listener();
  };
  listeners.add(listener);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function enable(): void {
  write(ENABLED_KEY, true);
  notify();
}

function disable(): void {
  write(ENABLED_KEY, false);
  notify();
}

function acceptOptIn(): void {
  write(OPTED_IN_KEY, true);
  write(ENABLED_KEY, true);
  notify();
}

function resetOptIn(): void {
  write(OPTED_IN_KEY, false);
  notify();
}

export function usePracticeMode(): UsePracticeModeResult {
  const enabled = useSyncExternalStore(subscribe, readEnabled);
  const hasOptedIn = useSyncExternalStore(subscribe, readHasOptedIn);
  return { enabled, hasOptedIn, enable, disable, acceptOptIn, resetOptIn };
}
