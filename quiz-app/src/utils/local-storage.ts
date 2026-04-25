// localStorage 安全讀寫 helper
// 統一處理：SSR safety (typeof window)、quota / disabled (try/catch)、
// boolean serialization (1/0 字串)。
// 之前散落在 usePracticeMode.ts、HomePage.tsx；抽出來共用避免漂移。

export function readBool(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function writeBool(key: string, value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* quota or disabled — silently ignore */
  }
}
