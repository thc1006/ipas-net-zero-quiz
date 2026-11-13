// 題目來源選單上星號題與待複習錯題的題數。
//
// 名單上可能有練習池題，練習池是懶載入的（不進 main bundle）：只有名單上出現主題庫沒有的 id 才載入，
// 載完之前題數不算數（isLoading）。載入失敗就用主題庫算，並回報 poolFailed，由畫面告訴使用者。
// 失敗之後到重新載入頁面之前都只用主題庫，開始測驗時也一樣（utils/review-pool.ts）：選單寫幾題就出幾題。
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { allQuestions, hasIdsOutsideMainBank } from '../data/questions';
import { getPracticePoolSync, toQuizQuestion } from '../utils/practice-pool';
import { isReviewPoolUnavailable, loadReviewPool, subscribeReviewPool } from '../utils/review-pool';
import { REVIEW_SOURCES, reviewCandidates, reviewIds } from '../utils/question-source';
import { useReview } from './useReview';
import type { PracticePool } from '../types/practicePool';
import type { ExamSubject, QuizQuestion, ReviewSource } from '../types/quiz';

export type ReviewCounts = Record<ReviewSource, number>;

interface UseReviewQuestionsResult {
  /** 這個考科範圍每個來源可出幾題 */
  counts: ReviewCounts;
  /** 不分考科可出幾題：一題都沒有時，用來分辨要換考科還是要先加題目 */
  totals: ReviewCounts;
  /** 練習池還在載入，counts 還不算數 */
  isLoading: boolean;
  poolFailed: boolean;
}

export function useReviewQuestions(subject: ExamSubject | 'all'): UseReviewQuestionsResult {
  const review = useReview();
  const needsPool = useMemo(() => hasIdsOutsideMainBank(reviewIds('review:both', review)), [review]);
  const [pool, setPool] = useState<PracticePool | null>(getPracticePoolSync);
  const poolFailed = useSyncExternalStore(subscribeReviewPool, isReviewPoolUnavailable);

  useEffect(() => {
    if (!needsPool || pool || poolFailed) return;
    let cancelled = false;
    void loadReviewPool().then((p) => {
      if (!cancelled && p) setPool(p);
    });
    return () => {
      cancelled = true;
    };
  }, [needsPool, pool, poolFailed]);

  // 失敗過就不用，快取裡有也一樣：開始測驗時也不會用（loadReviewPool）
  const usablePool = poolFailed ? null : pool;
  const bank = useMemo<QuizQuestion[]>(
    () => (usablePool ? [...allQuestions, ...usablePool.items.map(toQuizQuestion)] : allQuestions),
    [usablePool]
  );

  const countFor = (s: ExamSubject | 'all'): ReviewCounts =>
    Object.fromEntries(
      REVIEW_SOURCES.map((source) => [source, reviewCandidates(bank, s, source, review).length])
    ) as ReviewCounts;

  const counts = useMemo(() => countFor(subject), [bank, review, subject]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = useMemo(() => countFor('all'), [bank, review]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    counts,
    totals,
    isLoading: needsPool && !usablePool && !poolFailed,
    // 名單上的練習池題都拿掉之後，失敗就不重要了
    poolFailed: needsPool && poolFailed,
  };
}
