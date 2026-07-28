// 測驗進度持久化（in-progress quiz state）
//
// 動機：使用者中途離開（關 tab、reload、phone died）時保留進度，
// 下次進首頁可選擇繼續。Refs #71。
//
// 持久化策略（依 ultrathink design）：
// - 永不自動過期（10KB 數量級、永久 key 覆寫不膨脹）
// - 只在 finishQuiz / resetQuiz 時清除，由 useQuiz 主動呼叫
// - shape 不符時靜默丟棄（取代 throw，避免阻擋正常啟動）
//
// 最小化持久化（#106，SCHEMA_VERSION=2）：
//   主題庫題目可由 id 從靜態題庫（getQuestionById）重建，因此**只存 id 字串**，
//   不再把每題的 stem／options／explanation／sources 全寫進 localStorage（payload
//   大幅縮小）。練習池題目為動態載入、不在靜態題庫中，getQuestionById 找不到 →
//   **原樣保留整個物件**（如此 resume 不需 async 載入練習池即可同步重建）。
//
//   重要不變量：
//   - 計分不受重建影響 —— finishQuiz 由自足的 answers[]（correctAnswer/isCorrect）
//     計分，不看重建後的題目物件；重建只影響 resume 時**顯示**的題目內容。
//   - 若某題內容在 save 與 resume 之間因更正而變動（例：答案修正／換選項），resume
//     會顯示**現行題庫**的最新內容（auto-heal，非 bug）；若該 id 已從題庫移除，
//     整份 resume 放棄（回 null），避免題數錯位／currentIndex 越界。
//   - 向後相容：v1（全物件）payload 仍可載入 —— 重建把物件原樣返回。

import type { QuizState } from '../hooks/useQuiz';
import type { QuizQuestion } from '../types/quiz';
import { getQuestionById } from '../data/questions';

const STORAGE_KEY = 'ipas-quiz-in-progress';
const SCHEMA_VERSION = 2;
// v1（全物件）與 v2（主題庫題最小化為 id）都要能載入，避免打壞既有已上線的 resume。
const SUPPORTED_VERSIONS = new Set<number>([1, 2]);

/** 序列化時每題的儲存形態：字串 id（主題庫、可重建）或完整物件（練習池／舊格式）。 */
type StoredQuestion = string | QuizQuestion;

/** localStorage 內實際存放的 payload（questions 已最小化）。 */
interface PersistedProgressRaw {
  version: number;
  savedAt: number; // epoch ms
  state: Omit<QuizState, 'questions'> & { questions: StoredQuestion[] };
}

/** loadProgress 對外回傳的 payload：questions 已重建為完整 QuizQuestion[]（對呼叫端透明）。 */
export interface PersistedProgress {
  version: number;
  savedAt: number;
  state: QuizState;
}

/**
 * 把單一題目最小化為儲存形態。
 * 主題庫題目（getQuestionById 找得到、且 stem 相符）→ 只存 id 字串；
 * 其餘（練習池、id 撞號或找不到）→ 原樣保留完整物件。
 * stem 相符檢查是保險：避免練習池 id 意外撞到主題庫 id 而重建成錯題。
 */
function minifyQuestion(q: QuizQuestion): StoredQuestion {
  const canonical = getQuestionById(q.id);
  return canonical && canonical.stem === q.stem ? q.id : q;
}

/**
 * 重建整份 state.questions；任一字串 id 在現行題庫找不到 → 回 null（整份放棄 resume）。
 * 物件形態（練習池／v1 全物件）原樣返回。
 */
function reconstructState(
  rawState: PersistedProgressRaw['state']
): QuizState | null {
  const questions: QuizQuestion[] = [];
  for (const stored of rawState.questions) {
    if (typeof stored === 'string') {
      const q = getQuestionById(stored);
      // id 指向的題目已從題庫移除 → 放棄整份 resume（保守：不 resume 破碎題組）。
      // 註：這與 resumeQuiz 對「答案被 null 掉」的部分還原刻意不對稱 —— 題目「刪除」
      // 極罕見（通常是就地更正而非刪除），故選簡單保守的整份放棄，不複製 re-anchor 邏輯。
      if (!q) return null;
      questions.push(q);
    } else if (stored && typeof stored === 'object') {
      questions.push(stored);
    } else {
      // null／數字／其他垃圾元素 → payload 已損壞，放棄整份，
      // 避免 resumeQuiz 對 undefined 題目取 .hasAnswer 而在「繼續測驗」時 crash。
      return null;
    }
  }
  return { ...rawState, questions } as QuizState;
}

/** Save in-progress quiz state. No-op if state.isActive is false. */
export function saveProgress(state: QuizState): void {
  if (!state.isActive) return;
  const payload: PersistedProgressRaw = {
    version: SCHEMA_VERSION,
    savedAt: Date.now(),
    state: { ...state, questions: state.questions.map(minifyQuestion) },
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage 失敗（quota / private mode）— 靜默忽略
  }
}

/** Load saved progress. Returns null if absent / wrong shape / wrong version / 題目已失聯. */
export function loadProgress(): PersistedProgress | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidEnvelope(parsed)) {
      // shape 不符 → 直接清掉避免下次再吃壞資料
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    const state = reconstructState(parsed.state);
    // 重建失敗（題目失聯）或重建後語意檢查不過 → 一併清掉
    if (!state || !isValidState(state)) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return { version: parsed.version, savedAt: parsed.savedAt, state };
  } catch {
    // JSON.parse 失敗（壞掉的 JSON）也清掉，避免下次載入重複吃同一筆壞資料
    // 巢狀 try：removeItem 在 quota / private mode 下亦可能 throw
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
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

/**
 * Envelope 檢查：確認外層 version / savedAt / state / questions 陣列 shape 正確，
 * 足以安全嘗試重建。語意檢查（currentIndex 範圍、active 必要欄位）留給 isValidState
 * 在**重建後**的完整 state 上做。
 */
function isValidEnvelope(v: unknown): v is PersistedProgressRaw {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<PersistedProgressRaw>;
  if (typeof p.version !== 'number' || !SUPPORTED_VERSIONS.has(p.version)) {
    return false;
  }
  if (typeof p.savedAt !== 'number') return false;
  const s = p.state as unknown;
  if (!s || typeof s !== 'object') return false;
  if (!Array.isArray((s as { questions?: unknown }).questions)) return false;
  return true;
}

/**
 * 語意檢查：對**重建後**的完整 QuizState 驗證欄位與範圍，確保 resume 不會卡死或算錯。
 */
function isValidState(st: QuizState): boolean {
  // 基本 shape
  if (typeof st.isActive !== 'boolean') return false;
  if (!Array.isArray(st.questions)) return false;
  if (typeof st.currentIndex !== 'number') return false;
  if (!Array.isArray(st.answers)) return false;
  // answers 每筆須為非 null 物件 —— 否則 finishQuiz 的 a.correctAnswer、submitAnswer
  // 的 a.questionId 會對 null 取值而在續作／完成時 crash（防損壞或竄改的 localStorage；
  // 與最小化無關，但重建路徑既已加深驗證，一併把對稱的 answers 破綻補上）。
  if (!(st.answers as unknown[]).every((a) => a !== null && typeof a === 'object')) {
    return false;
  }

  // currentIndex 必須在 questions 範圍內（避免 resume 後 currentQuestion=null
  // 觸發 QuizPage 的「載入中...」永遠 stuck）
  if (st.currentIndex < 0) return false;
  if (st.questions.length === 0) {
    // 空題庫只能允許 currentIndex=0 + isActive=false 這種 idle 不該被 resume 的狀態
    if (st.isActive) return false;
  } else if (st.currentIndex >= st.questions.length) {
    return false;
  }

  // active 狀態下必要欄位（避免 finishQuiz 算分失敗回 null）
  if (st.isActive) {
    if (typeof st.startTime !== 'number') return false;
    if (st.config === null || typeof st.config !== 'object') return false;
  }

  return true;
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
