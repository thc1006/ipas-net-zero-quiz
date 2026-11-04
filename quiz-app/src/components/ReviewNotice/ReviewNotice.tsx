// 星號與待複習錯題要告訴使用者的事（Discussion #1）。都排在文件流裡，不蓋住任何東西，也不移動焦點：
// - ButtonNotice：星號、移出待複習按下去引起的（第一次加星號、沒有儲存、按下去才發現的新版資料與搬不走的壞資料），
//   排在那顆按鈕那一列的正下方。它上面的東西都不動，按鈕不會從指標底下移走，第二下點同一個位置還是那顆按鈕。
//   它屬於那張題卡：換題、換畫面就收掉。
// - ReviewNotice、EndNotice：頁面的（新版資料、壞資料、練習池載入失敗、結束測驗時沒有儲存）。換畫面時已經有的
//   排在主內容最上面，之後別的分頁造成的排在主內容最後面（hooks/useReview.ts 的 usePageNotices）。
// 看得到的字是一般內容。螢幕閱讀器由 ReviewAnnouncer 念：插進頁面的 live region 不一定會念，
// 所以用一個開頁就在、看不見的。每一次新的提示都念，字一樣也念；提示收掉時清空（announce.ts）。
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { END_RESOLVED_TEXT, NOTICE_TEXT, useButtonNotice, type PageEnd } from '../../hooks/useReview';
import {
  dismissButtonNotice,
  markStarHintSeen,
  type ReviewButton,
  type ReviewNotice as Notice,
} from '../../utils/review-storage';
import { announce, attachLiveRegion, withdraw } from './announce';
import './ReviewNotice.css';

/** 這一次的提示念給螢幕閱讀器：event 換了就是新的一次；收掉或換成下一次時清空 */
function useAnnounce(text: string | null, event: unknown): void {
  const [owner] = useState(() => ({}));
  useEffect(() => {
    if (!text) return;
    announce(owner, text);
    return () => withdraw(owner);
  }, [owner, text, event]);
}

/** 主內容最上面那一段說的是什麼（App.tsx 提供） */
export const TopNoticeContext = createContext<Notice | null>(null);

/** 主內容最上面的那一段：換畫面時已經有的，到換畫面之前不變 */
export function ReviewNotice({ notice }: { notice: Notice | null }) {
  const text = notice && NOTICE_TEXT[notice];
  useAnnounce(text, notice);
  if (!text) return null;
  return <p className="review-notice review-notice--page">{text}</p>;
}

/**
 * 主內容最後面的那一段（別的分頁造成的）。到換畫面之前不收掉也不變矮：捲到最底時它一變矮，頁面跟著變短，
 * 瀏覽器把捲動位置往上拉，上面的東西全部往下移，剛按的按鈕從指標底下移走。說的事不成立了就改說已經恢復，
 * 高度留在它最高的時候（min-height）。換畫面時整段拿掉，下一段從頭量。
 */
export function EndNotice({ end }: { end: PageEnd | null }) {
  const text = end && (end.resolved ? END_RESOLVED_TEXT : NOTICE_TEXT[end.notice]);
  const ref = useRef<HTMLParagraphElement>(null);
  const tallest = useRef(0);
  useAnnounce(text, text);
  // 每次畫完量一次，記下最高的：下一次換成短的字時 min-height 已經在了，中間不會先變矮一次
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      tallest.current = 0;
      return;
    }
    const height = el.getBoundingClientRect().height;
    if (height > tallest.current) {
      tallest.current = height;
      el.style.minHeight = `${height}px`;
    }
  }, [text]);
  if (!text) return null;
  return (
    <p
      ref={ref}
      className={`review-notice review-notice--page review-notice--end${end?.resolved ? ' review-notice--resolved' : ''}`}
    >
      {text}
    </p>
  );
}

interface ButtonNoticeProps {
  button: ReviewButton;
  questionId: string;
}

/** 現況（不是這一次寫入的結果）：主內容最上面已經說了，按鈕下面不再說一次 */
const STATE_NOTICES: ReadonlySet<Notice> = new Set(['newer', 'corrupt-stuck']);

/** 這一次按下去沒有生效：說明一定要看得到 */
const FAILURES: ReadonlySet<Notice> = new Set(['write-failed', 'newer', 'corrupt-stuck']);

/** 第一次加星號的提示露出多少才算看到 */
const SEEN_RATIO = 0.75;

/**
 * 提示在視窗外時（按鈕在視窗底部，提示排在它下面）：
 * - 沒有生效的（存不進去、新版資料、搬不走）：捲到剛好看得到（block: 'nearest'，html 的 scroll-padding-top 留給頁首）。
 *   按鈕沒有切換，頁面動了第二下也不會切錯。焦點不動。在畫出來之前捲，不先畫一次在視窗外的。
 * - 第一次加星號的提示：不捲（星號要留在指標底下），大半露出來才算看過；沒看到的話下次加星號再說一次。
 */
function useNoticeInView(
  ref: RefObject<HTMLParagraphElement | null>,
  notice: Notice | null,
  seq: number | undefined
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && notice && FAILURES.has(notice)) el.scrollIntoView({ block: 'nearest' });
  }, [ref, notice, seq]);

  useEffect(() => {
    const el = ref.current;
    if (!el || notice !== 'first-star') return;
    if (typeof IntersectionObserver === 'undefined') {
      markStarHintSeen();
      return;
    }
    // 頁首是 sticky，蓋在視窗最上面：被它蓋住的部分不算看到
    const header =
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--app-header-height')
      ) || 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting && e.intersectionRatio >= SEEN_RATIO)) {
          markStarHintSeen();
          observer.disconnect();
        }
      },
      { threshold: SEEN_RATIO, rootMargin: `-${header}px 0px 0px 0px` }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, notice, seq]);
}

export function ButtonNotice({ button, questionId }: ButtonNoticeProps) {
  const event = useButtonNotice(button, questionId);
  const top = useContext(TopNoticeContext);
  const notice = event && !(STATE_NOTICES.has(event.notice) && event.notice === top) ? event : null;
  const ref = useRef<HTMLParagraphElement>(null);
  // 題卡換掉（換題）時收掉：回到那一題時不再出現，不再捲、不再念
  useEffect(() => () => dismissButtonNotice(button, questionId), [button, questionId]);
  useAnnounce(notice?.text ?? null, notice?.seq);
  useNoticeInView(ref, notice?.notice ?? null, notice?.seq);
  return notice ? (
    <p className="review-notice" ref={ref}>
      {notice.text}
    </p>
  ) : null;
}

/** 字不經過 React：由 announce.ts 直接改，清空與放字才是兩次 DOM 變動 */
export function ReviewAnnouncer() {
  return (
    <p
      ref={attachLiveRegion}
      className="review-live sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    />
  );
}

export default ReviewNotice;
