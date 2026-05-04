// 每題作答統計（local-only correctness rate；Refs #64）
//
// 設計：
// - 寫入時機：finishQuiz 一次 bulk 寫入（不在 submitAnswer 即時寫）
//   理由：useQuiz 在同一 quiz session 內允許使用者點「上一題」改答，
//   submitAnswer 會被多次呼叫。state.answers 已用 questionId 去重
//   （useQuiz.ts findIndex 覆寫邏輯），所以從 finishQuiz 拿到的就是
//   一題一筆「該 quiz 最終答」，剛好是我們要記為 1 次 attempt 的結果。
// - aborted（softReset）/ resetQuiz 不觸發 finishQuiz，故不寫 stats —
//   未完成的 quiz 不算數，語義一致。
// - localStorage 容量試算：~870 題 × ~80 bytes ≈ 70 KB（遠 < 5 MB quota）

const STORAGE_KEY = 'ipas-question-stats';
const SCHEMA_VERSION = 1;

export interface QuestionStat {
  attempts: number;
  correct: number;
  /** epoch ms — 用於 ResultPage 弱題排序 tie-break */
  lastTriedAt: number;
}

interface PersistedStats {
  version: typeof SCHEMA_VERSION;
  items: Record<string, QuestionStat>;
}

export interface AttemptUpdate {
  id: string;
  isCorrect: boolean;
  /** epoch ms */
  at: number;
}

/** Load all stats. Returns {} on absent / wrong shape / quota error. */
export function loadStats(): Record<string, QuestionStat> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidPayload(parsed)) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      return {};
    }
    return parsed.items;
  } catch {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return {};
  }
}

/**
 * Bulk-record attempts. Increments attempts (and correct if isCorrect=true)
 * for each entry; updates lastTriedAt to the latest `at` per question.
 * Empty input is a no-op (avoids touching storage).
 */
export function recordAttempts(updates: AttemptUpdate[]): void {
  if (updates.length === 0) return;
  const current = loadStats();
  for (const u of updates) {
    const prev = current[u.id];
    const attempts = (prev?.attempts ?? 0) + 1;
    const correct = (prev?.correct ?? 0) + (u.isCorrect ? 1 : 0);
    const lastTriedAt = Math.max(prev?.lastTriedAt ?? 0, u.at);
    current[u.id] = { attempts, correct, lastTriedAt };
  }
  const payload: PersistedStats = {
    version: SCHEMA_VERSION,
    items: current,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode — 靜默 */
  }
}

/** 清除所有作答統計（SettingsPage「清除作答統計」按鈕用）. */
export function clearStats(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * 從 stats dict 篩選 + 排序「最常答錯」清單（Refs #64）。
 * 條件：attempts >= minAttempts 且 correct/attempts < maxRate
 * 排序：rate 升冪 → attempts 降冪 → lastTriedAt 降冪
 *
 * Pure 函式，方便單元測試；ResultPage 用 stemLookup 把 id 轉題幹後渲染。
 */
export interface WeakItem {
  id: string;
  attempts: number;
  correct: number;
  rate: number;
  lastTriedAt: number;
}

export function selectWeakQuestions(
  stats: Record<string, QuestionStat>,
  opts: { minAttempts: number; maxRate: number; limit: number }
): WeakItem[] {
  const out: WeakItem[] = [];
  for (const [id, s] of Object.entries(stats)) {
    if (s.attempts < opts.minAttempts) continue;
    const rate = s.correct / s.attempts;
    if (rate >= opts.maxRate) continue;
    out.push({ id, attempts: s.attempts, correct: s.correct, rate, lastTriedAt: s.lastTriedAt });
  }
  out.sort((a, b) => {
    if (a.rate !== b.rate) return a.rate - b.rate;
    if (a.attempts !== b.attempts) return b.attempts - a.attempts;
    return b.lastTriedAt - a.lastTriedAt;
  });
  return out.slice(0, opts.limit);
}

function isValidPayload(v: unknown): v is PersistedStats {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<PersistedStats>;
  if (p.version !== SCHEMA_VERSION) return false;
  if (!p.items || typeof p.items !== 'object') return false;
  for (const [, stat] of Object.entries(p.items)) {
    if (!stat || typeof stat !== 'object') return false;
    const s = stat as Partial<QuestionStat>;
    if (typeof s.attempts !== 'number' || !Number.isFinite(s.attempts) || s.attempts < 0) return false;
    if (typeof s.correct !== 'number' || !Number.isFinite(s.correct) || s.correct < 0) return false;
    if (s.correct > s.attempts) return false;
    if (typeof s.lastTriedAt !== 'number' || !Number.isFinite(s.lastTriedAt)) return false;
  }
  return true;
}
