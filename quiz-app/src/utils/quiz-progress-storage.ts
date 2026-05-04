// 測驗進度持久化（in-progress quiz state）
//
// 動機：使用者中途離開（關 tab、reload、phone died）時保留進度，
// 下次進首頁可選擇繼續。Refs #71。
//
// 持久化策略（依 ultrathink design）：
// - 永不自動過期（10KB 數量級、永久 key 覆寫不膨脹）
// - 只在 finishQuiz / resetQuiz 時清除，由 useQuiz 主動呼叫
// - shape 不符時靜默丟棄（取代 throw，避免阻擋正常啟動）

import type { QuizState } from '../hooks/useQuiz';

const STORAGE_KEY = 'ipas-quiz-in-progress';
const SCHEMA_VERSION = 1;

interface PersistedProgress {
  version: typeof SCHEMA_VERSION;
  savedAt: number; // epoch ms
  state: QuizState;
}

/** Save in-progress quiz state. No-op if state.isActive is false. */
export function saveProgress(state: QuizState): void {
  if (!state.isActive) return;
  const payload: PersistedProgress = {
    version: SCHEMA_VERSION,
    savedAt: Date.now(),
    state,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage 失敗（quota / private mode）— 靜默忽略
  }
}

/** Load saved progress. Returns null if absent / wrong shape / wrong version. */
export function loadProgress(): PersistedProgress | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidPayload(parsed)) {
      // shape 不符 → 直接清掉避免下次再吃壞資料
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Clear stored progress unconditionally. */
export function clearProgress(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function isValidPayload(v: unknown): v is PersistedProgress {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<PersistedProgress>;
  if (p.version !== SCHEMA_VERSION) return false;
  if (typeof p.savedAt !== 'number') return false;
  const s = p.state;
  if (!s || typeof s !== 'object') return false;
  return (
    typeof (s as QuizState).isActive === 'boolean' &&
    Array.isArray((s as QuizState).questions) &&
    typeof (s as QuizState).currentIndex === 'number' &&
    Array.isArray((s as QuizState).answers)
  );
}

/** 計算「N 分鐘 / 小時 / 天前」相對時間字串，用於 resume hint */
export function formatRelativeTime(savedAt: number, now: number = Date.now()): string {
  const diffMs = Math.max(0, now - savedAt);
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return '剛才';
  if (diffMin < 60) return `${diffMin} 分鐘前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小時前`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} 天前`;
}
