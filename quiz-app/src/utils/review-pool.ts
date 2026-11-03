// 星號與待複習錯題用的練習池：首頁選單的題數與按下開始之後出的題目，都從這裡拿。
//
// 練習池載入失敗一次之後，到重新載入頁面之前都不再載入，只用主題庫：首頁說「重新載入之前只算主題庫裡的題目」，
// 選單寫幾題，開始的就是幾題。不然下一次載入成功時，選單寫 1 題、開始的卻是 2 題。
// 之後別的路徑載入成功（設定頁、加強練習）也一樣不用：說過只算主題庫，就不能不知不覺變多。
import { loadPracticePool } from './practice-pool';
import type { PracticePool } from '../types/practicePool';

let failed = false;
const listeners = new Set<() => void>();

/** 載入失敗過：這個頁面只用主題庫 */
export function isReviewPoolUnavailable(): boolean {
  return failed;
}

export function subscribeReviewPool(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 練習池；這個頁面載不到時是 null，不往外丟 */
export async function loadReviewPool(): Promise<PracticePool | null> {
  if (failed) return null;
  try {
    return await loadPracticePool();
  } catch {
    if (!failed) {
      failed = true;
      listeners.forEach((listener) => listener());
    }
    return null;
  }
}

/** 測試專用：回到沒有失敗過的狀態（勿於 production 使用） */
export function __resetReviewPoolForTesting(): void {
  failed = false;
  listeners.clear();
}
