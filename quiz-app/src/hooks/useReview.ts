// 星號與待複習錯題的 React 端：快照與要告訴使用者的訊息。寫入直接呼叫 utils/review-storage.ts，
// 同一個分頁與其他分頁的變動都由那裡通知。
import { useSyncExternalStore } from 'react';
import { PAGE_LOAD_FAILED } from '../utils/practice-pool';
import {
  getButtonNotice,
  getLatestButtonNotice,
  getReviewNotice,
  getReviewSnapshot,
  subscribeReview,
  type ReviewButton,
  type ReviewNotice,
  type ReviewSnapshot,
} from '../utils/review-storage';

const NOTICE_TEXT: Record<ReviewNotice, string> = {
  newer: '星號與待複習紀錄是新版網站寫入的，目前的版本只能讀取，變更不會儲存。請重新整理頁面更新。',
  'corrupt-stuck': '星號與待複習紀錄無法讀取，儲存空間也不夠另存原始內容，所以目前不會儲存變更。請清出瀏覽器空間後重新載入。',
  'write-failed': '這次變更沒有儲存。瀏覽器可能封鎖了網站資料，或儲存空間已滿。',
  recovered: '星號與待複習紀錄無法讀取，原始內容已另存，清單從空的開始。',
  'pool-failed': `${PAGE_LOAD_FAILED}這一場先出主題庫裡的題目。`,
  'first-star': '已加星號，首頁「題目來源」選「星號題」可以反覆練習。',
};

export function useReview(): ReviewSnapshot {
  return useSyncExternalStore(subscribeReview, getReviewSnapshot);
}

/** 頁面現在要告訴使用者的那一句話；沒有就是 null */
export function useReviewNotice(): string | null {
  const notice = useSyncExternalStore(subscribeReview, getReviewNotice);
  return notice && NOTICE_TEXT[notice];
}

/** 這顆按鈕上次按下去要說的話；沒有就是 null */
export function useButtonNotice(button: ReviewButton, id: string): string | null {
  const notice = useSyncExternalStore(subscribeReview, () => getButtonNotice(button, id));
  return notice && NOTICE_TEXT[notice];
}

/** 最近按的那顆按鈕上的那一句話 */
export function useLatestButtonNotice(): string | null {
  const notice = useSyncExternalStore(subscribeReview, getLatestButtonNotice);
  return notice && NOTICE_TEXT[notice];
}
