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
//   - 答對／答錯「數」不受重建影響 —— finishQuiz 由自足的 answers[]（correctAnswer/
//     isCorrect）計分，不看重建後的題目物件。
//   - 但重建用的是**現行題庫**（非保存當下）。若某題**標準答案**在 save 與 resume 之間
//     被更正，現行題目會與凍在舊答案的紀錄分裂。此分裂由 resumeQuiz 對帳消除：correctAnswer
//     與現行 answer 不符的紀錄一律丟棄、該題以未作答呈現、由使用者依現行內容重答（見
//     useQuiz.resumeQuiz）。這不是 silent auto-heal —— 答案變動一律回未作答重答。殘留：選項
//     文字在「答案字母不變」下被改寫僅屬顯示更新（計分以字母為準、相容），刻意不偵測（偵測
//     需存舊內容，違背最小化目的）。
//   - 若某題 id 已從題庫移除 → 整份 resume 放棄（回 null），避免題數錯位／currentIndex 越界。
//   - 向後相容：v1（全物件）payload 仍可載入 —— 重建把物件原樣返回。
//
//   儲存 key 版本化（避免部署期舊分頁誤刪新資料）：v2 寫入獨立 key（…-v2），讀取先 v2、
//   再回退 legacy v1 key。已部署的舊 bundle 只認 version=1，遇 v2 會判為壞資料並 removeItem
//   —— 若共用同一 key，舊分頁一導覽回首頁就會刪掉新分頁剛寫的 v2 進度。分開 key 後舊 bundle
//   看不到 v2、刪不到；新 bundle 永遠優先採 v2。

import type { QuizState } from '../hooks/useQuiz';
import type { QuizQuestion } from '../types/quiz';
import { getQuestionById } from '../data/questions';

// v2 用獨立 key，與已部署的 v1 bundle 隔離（見檔頭「儲存 key 版本化」）。
const STORAGE_KEY = 'ipas-quiz-in-progress-v2';
const LEGACY_STORAGE_KEY = 'ipas-quiz-in-progress'; // v1 舊 key，僅讀取時回退用
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
 * 最小 shape 檢查：重建後的題目至少要有 id/stem/options，否則 QuizPage/QuestionCard
 * 讀 .options/.stem 會 crash。只擋損壞／竄改的 localStorage —— 主題庫重建與正常存下的
 * 練習池物件都必然通過；不做更深的語意驗證（那屬過度工程）。
 */
function isPlausibleQuestion(q: unknown): q is QuizQuestion {
  if (!q || typeof q !== 'object') return false;
  const x = q as Partial<QuizQuestion>;
  if (typeof x.id !== 'string' || typeof x.stem !== 'string') return false;
  // options 不只要是陣列，每個元素也要有 key/text 字串 —— QuestionCard 會 o.text.startsWith、
  // o.key，遇 null 或缺欄位的選項一樣 crash。這是「防 crash」的最小完整集，非語意驗證。
  if (!Array.isArray(x.options)) return false;
  return (x.options as unknown[]).every(
    (o) =>
      !!o &&
      typeof o === 'object' &&
      typeof (o as { key?: unknown }).key === 'string' &&
      typeof (o as { text?: unknown }).text === 'string'
  );
}

/**
 * 重建整份 state.questions；任一字串 id 在現行題庫找不到 → 回 null（整份放棄 resume）。
 * 物件形態（練習池／v1 全物件）原樣返回（先過最小 shape 檢查）。
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
    } else if (isPlausibleQuestion(stored)) {
      questions.push(stored);
    } else {
      // null／數字／shape 不符（缺 id/stem/options）的物件 → payload 已損壞，放棄整份。
      // 否則 resumeQuiz 取 .hasAnswer、或 QuestionCard 讀 .options 會在「繼續測驗」時 crash，
      // 且壞資料留在 localStorage 會導致每次重試都再 crash（poisoned state）。
      return null;
    }
  }
  return { ...rawState, questions } as QuizState;
}

/** 清掉 v2 與 legacy v1 兩個 key（各自吞掉 quota/private-mode 例外）。 */
function removeStored(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
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
    // 先讀 v2 key，沒有再回退 legacy v1 key（部署後首次 resume 的一次性遷移）。
    const raw =
      localStorage.getItem(STORAGE_KEY) ??
      localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidEnvelope(parsed)) {
      // shape 不符 → 直接清掉避免下次再吃壞資料
      removeStored();
      return null;
    }
    const state = reconstructState(parsed.state);
    // 重建失敗（題目失聯）或重建後語意檢查不過 → 一併清掉
    if (!state || !isValidState(state)) {
      removeStored();
      return null;
    }
    return { version: parsed.version, savedAt: parsed.savedAt, state };
  } catch {
    // JSON.parse 失敗（壞掉的 JSON）也清掉，避免下次載入重複吃同一筆壞資料
    removeStored();
    return null;
  }
}

/** Clear stored progress unconditionally（v2 + legacy 兩個 key 都清）。 */
export function clearProgress(): void {
  removeStored();
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
  // 整數 —— 拒 2.5/NaN/Infinity（否則 questions[i]=undefined → currentQuestion=null → 卡「載入中」）
  if (!Number.isInteger(st.currentIndex)) return false;
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
