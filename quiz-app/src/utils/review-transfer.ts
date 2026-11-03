// 星號與待複習錯題的匯出與匯入（Discussion #1）。資料只存在瀏覽器裡：使用 Safari 的七天內沒開這個網站就可能清掉，
// 也不能跨裝置，匯出的檔案就是備份。
//
// 匯入的是使用者手上的檔案，不是我們自己寫的資料：先全部檢查，有一項不對就整份拒絕，不做部分匯入。
// 這裡只解析、不寫入；合併在 mergeReview，那裡才碰 localStorage。
import {
  isPlainRecord,
  isReviewTime,
  isReviewWrongEntry,
  newerTime,
  newerWrong,
  notAfter,
  toCurrentIds,
  type ReviewSnapshot,
  type ReviewStars,
  type ReviewWrong,
  type ReviewWrongEntry,
} from './review-storage';

const APP_NAME = 'ipas-net-zero-quiz';
const SCHEMA = 1;

/** 全部題目 × 每題約 60 bytes 才 70 KB；1 MB 夠裝題庫長十倍 */
export const REVIEW_IMPORT_MAX_BYTES = 1024 * 1024;

// 題庫與練習池的 id 都在這個範圍內（review-transfer.test.ts 逐一檢查）
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

export type ReviewImportResult =
  | { ok: true; stars: ReviewStars; wrong: ReviewWrong }
  | { ok: false; reason: string };

export function buildReviewExport(review: Pick<ReviewSnapshot, 'stars' | 'wrong'>, now: Date): string {
  return JSON.stringify(
    {
      app: APP_NAME,
      schema: SCHEMA,
      exportedAt: now.toISOString(),
      stars: review.stars,
      wrong: review.wrong,
    },
    null,
    2
  );
}

/** 檔名用本地日期：台灣的早上八點以前，toISOString 還是昨天 */
export function reviewExportFileName(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `ipas-review-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/** 備份裡有幾題不在 known 裡（重複出現在星號與待複習的算一題） */
export function countUnknownIds(
  data: Pick<ReviewSnapshot, 'stars' | 'wrong'>,
  known: ReadonlySet<string>
): number {
  const ids = new Set([...Object.keys(data.stars), ...Object.keys(data.wrong)]);
  return [...ids].filter((id) => !known.has(id)).length;
}

/** Object.prototype 上的名字（__proto__、constructor、toString…）與 prototype 都不能當 id */
const isSafeId = (id: string): boolean =>
  ID_PATTERN.test(id) && !(id in Object.prototype) && id !== 'prototype';

const shown = (id: string): string => (id.length > 40 ? `${id.slice(0, 40)}…` : id);

function reject(reason: string): ReviewImportResult {
  return { ok: false, reason };
}

export function parseReviewImport(text: string): ReviewImportResult {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return reject('這個檔案不是備份檔，內容無法讀取。');
  }
  if (!isPlainRecord(root) || root.app !== APP_NAME) return reject('這不是這個網站的備份檔。');
  if (typeof root.schema === 'number' && root.schema > SCHEMA) {
    return reject('這份備份是新版網站匯出的，請先重新整理頁面更新。');
  }
  if (root.schema !== SCHEMA) return reject('備份檔的格式版本不對。');
  const exportedAt = typeof root.exportedAt === 'string' ? Date.parse(root.exportedAt) : NaN;
  if (!Number.isFinite(exportedAt)) return reject('備份檔的匯出時間不對。');
  // 備份裡的紀錄不會比匯出時間新，也不會比現在新。合併時時間新的優先：放著未來的時間，
  // 之後答錯也蓋不過它，同一份備份每匯入一次就把舊的連續答對次數帶回來。
  // 匯出時間比現在晚是那台裝置的時鐘快：整份往前移同樣的時間，備份裡的先後與間隔不變。
  // 只截到現在的話，備份裡的時間都擠成現在，比匯入之後的答錯還新
  const skew = Math.max(0, exportedAt - Date.now());
  const limit = Math.max(0, exportedAt - skew);
  const time = (at: number): number => Math.max(0, notAfter(at - skew, limit));
  if (!isPlainRecord(root.stars)) return reject('備份檔的星號資料不對。');
  if (!isPlainRecord(root.wrong)) return reject('備份檔的待複習資料不對。');

  // 沒有 prototype 的字典：合併時的查詢與寫入才不必再防一次這些名字
  const stars = Object.create(null) as ReviewStars;
  for (const [id, at] of Object.entries(root.stars)) {
    if (!isSafeId(id)) return reject(`備份裡有無法辨識的題目編號：${shown(id)}`);
    if (!isReviewTime(at)) return reject(`星號的時間不對：${id}`);
    stars[id] = time(at);
  }
  const wrong = Object.create(null) as ReviewWrong;
  for (const [id, entry] of Object.entries(root.wrong)) {
    if (!isSafeId(id)) return reject(`備份裡有無法辨識的題目編號：${shown(id)}`);
    if (!isReviewWrongEntry(entry)) return reject(`待複習的紀錄不對：${id}`);
    const { streak, last }: ReviewWrongEntry = entry;
    wrong[id] = { streak, last: time(last) };
  }
  // 改過 id 的題目換成現在的 id：預覽的題數、題庫找不到的題數、合併都用現在的 id
  return {
    ok: true,
    stars: toCurrentIds(stars, newerTime),
    wrong: toCurrentIds(wrong, newerWrong),
  };
}

/** 檢查大小、讀檔、解析。大小在讀檔之前擋：大檔案一讀進來分頁就卡住了 */
export async function readReviewImport(file: File): Promise<ReviewImportResult> {
  if (file.size > REVIEW_IMPORT_MAX_BYTES) return reject('檔案太大，上限是 1 MB。');
  let text: string;
  try {
    text = await file.text();
  } catch {
    return reject('讀不到這個檔案。');
  }
  return parseReviewImport(text);
}
