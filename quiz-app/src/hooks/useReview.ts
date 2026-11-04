// 星號與待複習錯題的 React 端：快照與要告訴使用者的訊息。寫入直接呼叫 utils/review-storage.ts，
// 同一個分頁與其他分頁的變動都由那裡通知。
import { useState, useSyncExternalStore } from 'react';
import { PAGE_LOAD_FAILED } from '../utils/practice-pool';
import {
  getButtonNoticeEvent,
  getReviewNotice,
  getUserWriteCount,
  getReviewSnapshot,
  subscribeReview,
  type ReviewButton,
  type ReviewNotice,
  type ReviewSnapshot,
} from '../utils/review-storage';

export const NOTICE_TEXT: Record<ReviewNotice, string> = {
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

/** 這顆按鈕上次按下去的那一次提示與要說的話；沒有就是 null */
export function useButtonNotice(
  button: ReviewButton,
  id: string
): { notice: ReviewNotice; text: string; seq: number } | null {
  const event = useSyncExternalStore(subscribeReview, () => getButtonNoticeEvent(button, id));
  return event && { notice: event.notice, text: NOTICE_TEXT[event.notice], seq: event.seq };
}

/**
 * 頁面的提示放在哪裡。top 排在主內容最上面，end 排在主內容最後面（頁面自己的內容之後、頁尾之前）；
 * endEvent 每次有新的 end 就換（螢幕閱讀器再念）。
 */
export interface PageNotices {
  top: ReviewNotice | null;
  end: ReviewNotice | null;
  endEvent: number;
}

interface PageNoticeState extends PageNotices {
  view: string;
  notice: ReviewNotice | null;
  writes: number;
}

/**
 * 頁面的提示只有換畫面時（view 換了、開頁）已經有的才排在主內容最上面，之後到換畫面之前不增不減：
 * 使用者開始操作之後，它上面的東西不能再被推動，收掉也一樣（過時了也留到換畫面）。之後才出現的：
 * - 使用者按出來的（按星號才發現新版資料或搬不走的壞資料、設定頁的清除與匯入）：說在那顆按鈕下面或設定頁的狀態列，
 *   頁面上不加。
 * - 沒有人按、別的分頁造成的（storage 事件）：排在主內容最後面，不推動使用者正在看的東西；收掉時也只動它下面的頁尾。
 *   使用者接著按了任何一顆會寫入的按鈕就收掉：那一次的結果說在那顆按鈕下面。
 */
export function usePageNotices(view: string): PageNotices {
  const notice = useSyncExternalStore(subscribeReview, getReviewNotice);
  const writes = useSyncExternalStore(subscribeReview, getUserWriteCount);
  const [state, setState] = useState<PageNoticeState>(() => ({ view, notice, writes, top: notice, end: null, endEvent: 0 }));
  let next = state;
  if (view !== state.view) {
    next = { view, notice, writes, top: notice, end: null, endEvent: state.endEvent };
  } else if (writes !== state.writes) {
    next = { ...state, notice, writes, end: null };
  } else if (notice !== state.notice) {
    const end = notice === state.top ? null : notice;
    next = { ...state, notice, end, endEvent: end ? state.endEvent + 1 : state.endEvent };
  }
  // render 時調整 state（React 文件的「props 變了就調整 state」）：這一次 render 就用新的，不多畫一次舊的
  if (next !== state) setState(next);
  return { top: next.top, end: next.end, endEvent: next.endEvent };
}
