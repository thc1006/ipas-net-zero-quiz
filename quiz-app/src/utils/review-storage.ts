// 星號與待複習錯題（Discussion #1）：同一支 localStorage key，模組層級的 store。
//
// 設計：
// - 每次寫入都先重讀 localStorage，不用快照改。兩個分頁各加一顆星時，沿用快照的那一邊會把另一邊蓋掉。
// - 讀是純的（useSyncExternalStore 會在 render 時呼叫）：搬走壞資料、帶入舊統計都發生在寫入時。
// - 讀不懂的資料不覆寫：壞資料先搬到 :corrupt 才從空的開始，搬不走就不寫；v 大於 1 是新版寫的，唯讀。
// - 認不得的 id 一律留著（練習池是懶載入的，題庫也會改），只在顯示時過濾。
// - 改過 id 的題目（metadata.renamed_from）讀的時候算到現在的 id，與作答統計、進度相同；下一次寫入才落地。
// - 時間超出 Date 的範圍算讀不懂；比現在晚的當成現在：合併時時間新的優先，未來的時間會一直贏。
// - 字典用沒有 prototype 的物件：id 是 __proto__、constructor 時，查詢與寫入都跟一般 id 一樣。
// - 測驗中途的事也記在這裡（removed、sessions），重新整理、續作、另一個分頁都看得到：
//   手動移出之前的作答不會加回；同一場（startTime）在兩個分頁都完成時只記一次。
// - localStorage 容量試算：~1100 題 × ~60 bytes ≈ 70 KB。
import { readBool, writeBool } from './local-storage';
import { isQuestionScorable } from './scorable';
import { loadStats } from './question-stats-storage';
import { currentQuestionId } from '../data/renamed-questions';
import type { AnswerRecord, QuizQuestion } from '../types/quiz';

export const REVIEW_STORAGE_KEY = 'ipas-review-v1';
export const REVIEW_CORRUPT_KEY = 'ipas-review-v1:corrupt';
/** 第一次加星號的提示顯示過了 */
const STAR_HINT_SEEN_KEY = 'ipas-review-star-hint-seen';
const SCHEMA_VERSION = 1;
/** 記幾場的 startTime：同一份進度在兩個分頁都完成，不會隔這麼多場才發生 */
const MAX_SESSIONS = 50;

/** 連續答對幾次移出待複習（所有者的決定，2026-11-01；不開放設定） */
export const REVIEW_REMOVE_STREAK = 2;

export interface ReviewWrongEntry {
  /** 進待複習之後連續答對幾次；答錯歸零，到 REVIEW_REMOVE_STREAK 就移出 */
  streak: number;
  /** epoch ms：最後一次作答 */
  last: number;
}

/** id → 加星號的時間（epoch ms） */
export type ReviewStars = Record<string, number>;
export type ReviewWrong = Record<string, ReviewWrongEntry>;

interface ReviewData {
  v: typeof SCHEMA_VERSION;
  seeded: boolean;
  stars: ReviewStars;
  wrong: ReviewWrong;
  /** id → 手動移出或清除的時間（epoch ms）：在這之前的作答不會把題目加回來 */
  removed: Record<string, number>;
  /** 已經記錄過的場次（startTime），舊的在前 */
  sessions: number[];
}

/** ok：可讀可寫；corrupt：讀不懂，下一次寫入前搬走；newer：新版資料，唯讀；unavailable：localStorage 讀不到 */
export type ReviewAccess = 'ok' | 'corrupt' | 'newer' | 'unavailable';

export interface ReviewSnapshot {
  access: ReviewAccess;
  seeded: boolean;
  stars: ReviewStars;
  wrong: ReviewWrong;
}

/** 要告訴使用者的事；畫面上的文字在 hooks/useReview.ts，放在哪裡見 components/ReviewNotice */
export type ReviewNotice =
  | 'newer'
  | 'corrupt-stuck'
  | 'write-failed'
  | 'recovered'
  | 'pool-failed'
  | 'first-star';

/** 會引起提示的按鈕：每一題的星號與移出待複習 */
export type ReviewButton = 'star' | 'remove';

/**
 * 按鈕上的一次提示。seq 每次都不同：同一句話再說一次（同一顆按鈕又存不進去）也是新的一次，
 * 螢幕閱讀器要再念
 */
export interface ReviewButtonNotice {
  notice: ReviewNotice;
  seq: number;
}

export interface ReviewResult {
  id: string;
  isCorrect: boolean;
  /** epoch ms */
  at: number;
}

/** 一場結束時的變動：added 是新進待複習（原本就在清單上的不算），removed 是答對移出 */
export interface ReviewSummary {
  added: number;
  removed: number;
}

/** 合併時新增幾題：原本就有的題目只更新時間，不算新增 */
export interface ReviewMergeCount {
  stars: number;
  wrong: number;
}

const dict = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

const hasOwn = (obj: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

export const isPlainRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Date 表示得出來的最晚時間（ECMAScript 的 time value 上限） */
const MAX_TIME = 8_640_000_000_000_000;

export const isReviewTime = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_TIME;

/** 比 limit 晚的時間改成 limit（通常是現在）。時鐘調過、匯入的檔案都可能帶著未來的時間 */
export const notAfter = (at: number, limit: number): number => Math.min(at, limit);

export function isReviewWrongEntry(v: unknown): v is ReviewWrongEntry {
  if (!isPlainRecord(v)) return false;
  const { streak, last } = v;
  return (
    typeof streak === 'number' &&
    Number.isInteger(streak) &&
    streak >= 0 &&
    streak < REVIEW_REMOVE_STREAK &&
    isReviewTime(last)
  );
}

/** 同一題有兩筆時間時留新的。一樣新就是同一個值，留哪一筆都一樣 */
export const newerTime = (a: number, b: number): boolean => a > b;

/**
 * 同一題有兩筆待複習紀錄時留 last 新的。一樣新時留連續答對次數少的：寧可多複習一次，
 * 也不要因為存的順序把題目提早移出（兩筆都一樣時就是同一個值）
 */
export const newerWrong = (a: ReviewWrongEntry, b: ReviewWrongEntry): boolean =>
  a.last > b.last || (a.last === b.last && a.streak < b.streak);

/**
 * 改過 id 的題目：舊 id 的紀錄算到現在的 id（question-stats-storage.ts 的 withCurrentIds 也是這樣）。
 * 同一題的幾筆（現在的 id、改過兩次以上的每一代舊 id）由 newer 挑一筆。newer 是嚴格的全序，
 * 只有值相同時兩邊都不贏，所以結果與存的順序無關。
 */
export function toCurrentIds<T>(items: Record<string, T>, newer: (a: T, b: T) => boolean): Record<string, T> {
  const out = dict<T>();
  for (const [id, value] of Object.entries(items)) {
    const current = currentQuestionId(id);
    if (!hasOwn(out, current) || newer(value, out[current])) out[current] = value;
  }
  return out;
}

/** 複製成沒有 prototype 的字典；JSON.parse 把 "__proto__" 存成自己的屬性，Object.entries 讀得到 */
function toDict<T>(
  source: unknown,
  accept: (v: unknown) => v is T,
  fix: (v: T) => T
): { items: Record<string, T>; clean: boolean } {
  const items = dict<T>();
  if (!isPlainRecord(source)) return { items, clean: false };
  let clean = true;
  for (const [id, value] of Object.entries(source)) {
    if (accept(value)) items[id] = fix(value);
    else clean = false;
  }
  return { items, clean };
}

const emptyData = (): ReviewData => ({
  v: SCHEMA_VERSION,
  seeded: false,
  stars: dict(),
  wrong: dict(),
  removed: dict(),
  sessions: [],
});

/** 這兩個欄位空的時候不寫出去：存的形狀與沒有用到它們時相同，「沒有變動就不寫入」也才比得出來 */
function serialize({ removed, sessions, ...core }: ReviewData): string {
  return JSON.stringify({
    ...core,
    ...(Object.keys(removed).length > 0 ? { removed } : {}),
    ...(sessions.length > 0 ? { sessions } : {}),
  });
}

function parseRaw(raw: string | null): { access: ReviewAccess; data: ReviewData } {
  if (raw === null) return { access: 'ok', data: emptyData() };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { access: 'corrupt', data: emptyData() };
  }
  if (!isPlainRecord(value)) return { access: 'corrupt', data: emptyData() };

  const now = Date.now();
  const time = (at: number) => notAfter(at, now);
  const stars = toDict(value.stars, isReviewTime, time);
  const wrong = toDict(value.wrong, isReviewWrongEntry, ({ streak, last }) => ({ streak, last: time(last) }));
  const removed = toDict(value.removed ?? {}, isReviewTime, time);
  const sessions = value.sessions ?? [];
  const sessionsClean = Array.isArray(sessions) && sessions.every(isReviewTime);
  const data: ReviewData = {
    v: SCHEMA_VERSION,
    seeded: value.seeded === true,
    stars: toCurrentIds(stars.items, newerTime),
    wrong: toCurrentIds(wrong.items, newerWrong),
    removed: toCurrentIds(removed.items, newerTime),
    sessions: sessionsClean ? sessions : [],
  };
  // 新版資料的形狀我們不一定懂：能讀的照讀，讀不懂的不算壞資料（它沒有壞，是這個版本太舊）
  if (typeof value.v === 'number' && value.v > SCHEMA_VERSION) return { access: 'newer', data };
  const valid =
    value.v === SCHEMA_VERSION &&
    typeof value.seeded === 'boolean' &&
    stars.clean &&
    wrong.clean &&
    removed.clean &&
    sessionsClean;
  return valid ? { access: 'ok', data } : { access: 'corrupt', data: emptyData() };
}

/** localStorage 這個 getter 本身也會丟例外（瀏覽器封鎖網站資料時），讀寫都要包在 try 裡 */
function readRaw(): { ok: true; raw: string | null } | { ok: false } {
  try {
    return { ok: true, raw: localStorage.getItem(REVIEW_STORAGE_KEY) ?? null };
  } catch {
    return { ok: false };
  }
}

// 快照依原始字串快取：useSyncExternalStore 比的是物件身分，每次回傳新物件會無限 render
let cachedRaw: string | null = null;
let cached: ReviewSnapshot | null = null;
const UNAVAILABLE: ReviewSnapshot = { access: 'unavailable', seeded: false, stars: dict(), wrong: dict() };

export function getReviewSnapshot(): ReviewSnapshot {
  const read = readRaw();
  if (!read.ok) return UNAVAILABLE;
  if (cached && read.raw === cachedRaw) return cached;
  const { access, data } = parseRaw(read.raw);
  cachedRaw = read.raw;
  cached = { access, seeded: data.seeded, stars: data.stars, wrong: data.wrong };
  return cached;
}

export function isStarred(review: Pick<ReviewSnapshot, 'stars'>, id: string): boolean {
  return hasOwn(review.stars, id);
}

export function wrongEntry(review: Pick<ReviewSnapshot, 'wrong'>, id: string): ReviewWrongEntry | undefined {
  return hasOwn(review.wrong, id) ? review.wrong[id] : undefined;
}

// 寫入失敗、資料毀損之類要告訴使用者的事。都不在 localStorage 裡，所以另外記一份。
// 頁面的提示（換畫面時已經有的排在主內容最上面，之後才出現的排在最後面，見 hooks/useReview.ts 的 usePageNotices）：
let writeFailed = false;
let recovered = false;
let poolFailed = false;
// 壞資料搬不走：這是現況，不是一次性的提示，clearReviewNotices 收不掉
let corruptStuck = false;
// 按鈕引起的提示（排在那顆按鈕那一列下面），key 是「按鈕:題目 id」。只有同一顆按鈕的下一次寫入換掉它，
// 別的按鈕與頁面的寫入都不動它：它收掉時下面的東西往上移，剛按的按鈕若在它下面就從指標底下移走。
// 同樣的理由，按鈕的寫入也不動頁面的提示
const buttonNotices = new Map<string, ReviewButtonNotice>();
let noticeSeq = 0;

function setButtonNotice(button: string, notice: ReviewNotice): void {
  buttonNotices.set(button, { notice, seq: ++noticeSeq });
}

// 使用者按下去的寫入（星號、移出待複習、設定頁的清除與匯入）做過幾次。頁面的提示在這之後變了，就是按出來的：
// 結果說在那顆按鈕下面或設定頁的狀態列，不加在頁面上（usePageNotices）
let userWrites = 0;

export function getUserWriteCount(): number {
  return userWrites;
}

/** 頁面現在要告訴使用者什麼；一次一件，由重要到不重要 */
export function getReviewNotice(): ReviewNotice | null {
  const { access } = getReviewSnapshot();
  if (access === 'newer') return 'newer';
  // 別的分頁把資料重寫成讀得懂的，就不再是「不會儲存」：不等這邊寫入，按星號時頁面最上面才不會少一段
  if (corruptStuck && access === 'corrupt') return 'corrupt-stuck';
  if (writeFailed) return 'write-failed';
  if (recovered) return 'recovered';
  if (poolFailed) return 'pool-failed';
  return null;
}

/** 這顆按鈕上次按下去的那一次提示；同一次回傳同一個物件（useSyncExternalStore 比的是身分） */
export function getButtonNoticeEvent(button: ReviewButton, id: string): ReviewButtonNotice | null {
  return buttonNotices.get(`${button}:${id}`) ?? null;
}

/** 這顆按鈕上次按下去要說的話 */
export function getButtonNotice(button: ReviewButton, id: string): ReviewNotice | null {
  return getButtonNoticeEvent(button, id)?.notice ?? null;
}

/**
 * 按鈕的提示屬於那顆按鈕所在的題卡：題卡換掉（換題）就收掉（ReviewNotice.tsx 的 ButtonNotice）。
 * 留著的話，回到那一題時舊的提示又出現，存不進去的說明還會再捲一次、再念一次
 */
export function dismissButtonNotice(button: ReviewButton, id: string): void {
  if (buttonNotices.delete(`${button}:${id}`)) notify();
}

/** 換頁、開新的一場時呼叫：一次性的提示不跟到別的畫面 */
export function clearReviewNotices(): void {
  if (!writeFailed && !recovered && !poolFailed && buttonNotices.size === 0) return;
  writeFailed = false;
  recovered = false;
  poolFailed = false;
  buttonNotices.clear();
  notify();
}

// storage 事件不會在寫入的分頁觸發，所以同一個分頁的變動由這裡通知每一個訂閱者
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

// 收到幾次別的分頁改了這支 key 的 storage 事件。頁面的提示在這之後變了，就是別的分頁造成的：
// 排在主內容最後面；其他沒有人按的變化排到下一個畫面的最上面（hooks/useReview.ts 的 usePageNotices）
let externalChanges = 0;

export function getExternalChangeCount(): number {
  return externalChanges;
}

function onStorage(e: StorageEvent): void {
  // e.key === null：另一個分頁呼叫 localStorage.clear()
  if (e.key !== REVIEW_STORAGE_KEY && e.key !== null) return;
  externalChanges += 1;
  notify();
}

export function subscribeReview(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

/**
 * 把讀不懂的字串搬到 :corrupt。那一格已經有別的內容時放下一格：第二次壞掉不能蓋掉第一次的。
 * 回傳 false 代表搬不走，呼叫端不能再寫。
 */
function quarantine(raw: string): boolean {
  try {
    let key = REVIEW_CORRUPT_KEY;
    for (let n = 2; ; n++) {
      const occupant = localStorage.getItem(key);
      if (occupant === raw) break;
      if (occupant === null || occupant === undefined) {
        localStorage.setItem(key, raw);
        break;
      }
      key = `${REVIEW_CORRUPT_KEY}:${n}`;
    }
    localStorage.removeItem(REVIEW_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** 帶入舊的作答統計：統計沒有記最後一次的對錯，所以曾經答錯過的題目都算（所有者的決定） */
function seedFromStats(data: ReviewData): void {
  if (data.seeded) return;
  for (const [id, stat] of Object.entries(loadStats())) {
    if (stat.correct < stat.attempts && !(id in data.wrong)) {
      // loadStats 接受負的時間，這裡不接受：照抄的話主資料下一次讀就成了壞資料
      data.wrong[id] = { streak: 0, last: isReviewTime(stat.lastTriedAt) ? notAfter(stat.lastTriedAt, Date.now()) : 0 };
    }
  }
  data.seeded = true;
}

/**
 * 寫入是誰引起的、要說的話放在哪裡：
 * - page：結束測驗時記錄作答，記在頁面上
 * - silent：使用者沒有動手（開站時帶入舊統計），失敗不打擾使用者，下次再試
 * - own：設定頁的清除與匯入，由呼叫端在自己的狀態列說，這裡不記任何提示
 */
type WriteReport = 'page' | 'silent' | 'own';

/**
 * 所有寫入的唯一入口：重讀、處理壞資料、帶入舊統計、套用變動、寫回。
 * button 是按下去引起這次寫入的按鈕（「star:題目 id」），要說的話記在它上面；沒有就看 report。
 */
function update(change: (data: ReviewData) => void, button: string | null = null, report: WriteReport = 'page'): boolean {
  if (button) buttonNotices.delete(button);
  const byUser = button !== null || report === 'own';
  if (byUser) userWrites += 1;
  const silent = !button && report !== 'page';
  // 按鈕按下去才發現的新版資料與搬不走的壞資料也說在那顆按鈕下面：頁面上已經說了的話，畫面那一層不重複
  // （ReviewNotice.tsx 的 ButtonNotice）。使用者按的寫入一定通知：頁面才知道這次的變化是按出來的
  const fail = (notice: ReviewNotice = 'write-failed'): false => {
    if (!silent) {
      if (!button) writeFailed = true;
      else setButtonNotice(button, notice);
    }
    if (!silent || byUser) notify();
    return false;
  };

  const read = readRaw();
  if (!read.ok) return fail();
  const parsed = parseRaw(read.raw);
  if (parsed.access === 'newer') return fail('newer');
  const { data } = parsed;
  const corrupt = parsed.access === 'corrupt';
  if (corrupt) {
    if (!quarantine(read.raw!)) {
      // 設定頁的寫入由那裡的狀態列說沒有存進去，頁面上不另外說
      if (report === 'own') return fail();
      corruptStuck = true;
      if (silent) notify();
      return fail('corrupt-stuck');
    }
    corruptStuck = false;
    if (!button && report !== 'own') recovered = true;
    // 畫面說從空的開始，就真的從空的開始：壞資料裡可能記著使用者清空過，舊統計不再帶入
    data.seeded = true;
  }

  seedFromStats(data);
  change(data);
  const next = serialize(data);
  if (next !== read.raw) {
    try {
      localStorage.setItem(REVIEW_STORAGE_KEY, next);
    } catch {
      return fail();
    }
  }
  // 寫得進去就是又能儲存了（例如另一個分頁清出空間、重寫了這支 key）
  corruptStuck = false;
  if (button) {
    if (corrupt) setButtonNotice(button, 'recovered');
  } else if (!silent) {
    writeFailed = false;
    if (!corrupt) recovered = false;
  }
  notify();
  return true;
}

/**
 * 請瀏覽器別清掉這個網站的資料。結果不影響任何事：不等它，失敗也不管。
 * Firefox 會跳詢問視窗（MDN 的 Storage quotas and eviction criteria；Firefox 157 實測 persist() 一直等使用者回應），
 * 使用者只是按了星號，不該被問：Firefox 只在已經允許過時呼叫。Chrome 與 Safari 不問，依網站的使用情形自動決定。
 * 不能只看 Permissions API：Chrome 沒允許過時也回 'prompt'，照它判斷的話 Chrome 永遠不會呼叫。
 */
function requestPersistence(): void {
  try {
    const storage = navigator.storage;
    if (!storage?.persist) return;
    if (!/\bFirefox\//.test(String(navigator.userAgent))) {
      storage.persist().catch(() => undefined);
      return;
    }
    navigator.permissions
      ?.query({ name: 'persistent-storage' as PermissionName })
      .then(({ state }) => (state === 'granted' ? storage.persist() : undefined))
      .catch(() => undefined);
  } catch {
    /* 舊瀏覽器或被政策擋掉 */
  }
}

/** 加或取消星號。傳的是使用者要的結果，不是切換：另一個分頁剛改過時，切換會切反 */
export function setStar(id: string, starred: boolean): boolean {
  const button = `star:${id}`;
  let added = false;
  let first = false;
  const saved = update((data) => {
    if (!starred) {
      delete data.stars[id];
    } else if (!(id in data.stars)) {
      added = true;
      first = Object.keys(data.stars).length === 0;
      data.stars[id] = Date.now();
    }
  }, button);
  if (saved && first) requestPersistence();
  // 真的看到了才算看過（markStarHintSeen）：提示在視窗外的話，下次加星號再說一次
  if (saved && added && !readBool(STAR_HINT_SEEN_KEY)) {
    // 「已另存」比較重要
    if (!buttonNotices.has(button)) setButtonNotice(button, 'first-star');
    notify();
  }
  return saved;
}

/** 第一次加星號的提示使用者看到了（ReviewNotice.tsx）：之後不再說 */
export function markStarHintSeen(): void {
  writeBool(STAR_HINT_SEEN_KEY, true);
}

/** 手動移出待複習；星號不動。記下時間：這一場已經答錯的話，結束測驗時不能加回來 */
export function removeFromReview(id: string): boolean {
  return update((data) => {
    if (!(id in data.wrong)) return;
    delete data.wrong[id];
    data.removed[id] = Date.now();
  }, `remove:${id}`);
}

// 設定頁的清除與匯入：成功、失敗、原本的資料讀不懂而另存，都由設定頁自己的狀態列說（ReviewBackup.tsx），
// 不記頁面或按鈕的提示，螢幕閱讀器也只念那一列

export function clearStars(): boolean {
  return update(
    (data) => {
      data.stars = dict();
    },
    null,
    'own'
  );
}

export function clearWrong(): boolean {
  return update(
    (data) => {
      const now = Date.now();
      for (const id of Object.keys(data.wrong)) data.removed[id] = now;
      data.wrong = dict();
    },
    null,
    'own'
  );
}

/** 開站時呼叫一次；已經帶入過就什麼都不寫 */
export function seedReview(): boolean {
  return update(() => undefined, null, 'silent');
}

/**
 * 一場測驗結束時記錄最終作答，與 recordAttempts 同一個時機：一場裡改答只算最後一次，放棄的測驗不算。
 * 答錯：進待複習、連續答對歸零，手動移出之前的作答除外。答對：只影響已經在待複習裡的題目。星號一律不動。
 * session 是這一場的 startTime：同一份進度在兩個分頁都完成時只記一次，不然一場就答對兩次而移出。
 * 寫入失敗回傳 null。
 */
export function recordReviewResults(results: ReviewResult[], session?: number): ReviewSummary | null {
  const summary: ReviewSummary = { added: 0, removed: 0 };
  if (results.length === 0) return summary;
  const saved = update((data) => {
    if (session !== undefined) {
      if (data.sessions.includes(session)) return;
      data.sessions = [...data.sessions, session].slice(-MAX_SESSIONS);
    }
    for (const { id, isCorrect, at } of results) {
      if (!isCorrect) {
        if (id in data.removed && at <= data.removed[id]) continue;
        if (!(id in data.wrong)) summary.added += 1;
        data.wrong[id] = { streak: 0, last: at };
      } else if (id in data.wrong) {
        const streak = data.wrong[id].streak + 1;
        if (streak >= REVIEW_REMOVE_STREAK) {
          delete data.wrong[id];
          summary.removed += 1;
        } else {
          data.wrong[id] = { streak, last: at };
        }
      }
    }
  });
  return saved ? summary : null;
}

/** 一場的最終作答裡，算數的那些：有作答、可計分。沒作答不算答錯（所有者的決定） */
export function reviewResultsFrom(questions: QuizQuestion[], answers: AnswerRecord[]): ReviewResult[] {
  const scorable = new Set(questions.filter((q) => isQuestionScorable(q)).map((q) => q.id));
  return answers
    .filter((a) => a.selectedAnswer !== null && a.isCorrect !== null && scorable.has(a.questionId))
    .map((a) => ({
      id: a.questionId,
      isCorrect: a.isCorrect === true,
      // 舊進度可能沒有這個欄位。沒有 last 的紀錄下一次讀就是壞資料
      at: isReviewTime(a.timestamp) ? notAfter(a.timestamp, Date.now()) : Date.now(),
    }));
}

/** 這份資料合併進來會新增幾題；只讀，匯入確認時顯示 */
export function previewMerge(incoming: Pick<ReviewSnapshot, 'stars' | 'wrong'>): ReviewMergeCount {
  const review = getReviewSnapshot();
  return {
    stars: Object.keys(incoming.stars).filter((id) => !isStarred(review, id)).length,
    wrong: Object.keys(incoming.wrong).filter((id) => !wrongEntry(review, id)).length,
  };
}

/**
 * 匯入：聯集，同一題留時間新的，一樣新時留原本的。絕不刪除也不覆寫較新的紀錄。
 * 回傳實際新增幾題；寫入失敗回傳 null。
 */
export function mergeReview(incoming: Pick<ReviewSnapshot, 'stars' | 'wrong'>): ReviewMergeCount | null {
  const count: ReviewMergeCount = { stars: 0, wrong: 0 };
  const saved = update(
    (data) => {
      for (const [id, at] of Object.entries(incoming.stars)) {
        if (!(id in data.stars)) count.stars += 1;
        if (!(id in data.stars) || at > data.stars[id]) data.stars[id] = at;
      }
      for (const [id, entry] of Object.entries(incoming.wrong)) {
        if (!(id in data.wrong)) count.wrong += 1;
        if (!(id in data.wrong) || entry.last > data.wrong[id].last) data.wrong[id] = entry;
      }
    },
    null,
    'own'
  );
  return saved ? count : null;
}

/** 練習池載入失敗，這一場只出主題庫的題目 */
export function reportReviewPoolFailure(): void {
  poolFailed = true;
  notify();
}

/** 測試專用：清掉模組狀態（勿於 production 使用） */
export function __resetReviewStoreForTesting(): void {
  cachedRaw = null;
  cached = null;
  writeFailed = false;
  recovered = false;
  poolFailed = false;
  corruptStuck = false;
  buttonNotices.clear();
  noticeSeq = 0;
  userWrites = 0;
  externalChanges = 0;
  listeners.clear();
  window.removeEventListener('storage', onStorage);
}
