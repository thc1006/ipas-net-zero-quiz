// 統一題庫來源 hook：依 practiceMode 旗標決定是否混入練習池題
import { useMemo, useEffect, useState } from 'react';
import { allQuestions, getQuestionsBySubject } from '../data/questions';
import { loadPracticePool } from '../utils/practice-pool';
import { toQuizQuestion } from '../utils/practice-pool';
import { usePracticeMode } from './usePracticeMode';
import type { QuizQuestion, ExamSubject } from '../types/quiz';
import type { PracticePoolItem } from '../types/practicePool';

interface UseQuizSourceResult {
  /** 主題庫題（永遠載入） */
  mainBank: QuizQuestion[];
  /** 加強練習池題（只有 enabled 才有） */
  poolItems: QuizQuestion[];
  /** 兩者合併（mainBank + poolItems if enabled） */
  combined: QuizQuestion[];
  isPoolLoading: boolean;
  poolError: Error | null;
}

/**
 * 取得當前可用的題庫來源；poolItems 僅在使用者開啟加強練習時提供。
 * Caller 可呼 getBySubject / getRandom 等 helper 自行抽題。
 */
export function useQuizSource(subject: ExamSubject | 'all' = 'all'): UseQuizSourceResult {
  const { enabled } = usePracticeMode();
  const [poolRaw, setPoolRaw] = useState<PracticePoolItem[]>([]);
  const [isPoolLoading, setIsPoolLoading] = useState<boolean>(false);
  const [poolError, setPoolError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled) {
      setPoolRaw([]);
      return;
    }
    let cancelled = false;
    setIsPoolLoading(true);
    setPoolError(null);
    loadPracticePool()
      .then((p) => {
        if (!cancelled) {
          setPoolRaw(p.items);
          setIsPoolLoading(false);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setPoolError(e);
          setIsPoolLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const mainBank = useMemo(
    () => (subject === 'all' ? allQuestions : getQuestionsBySubject(subject)),
    [subject]
  );

  const poolItems = useMemo<QuizQuestion[]>(() => {
    if (!enabled || poolRaw.length === 0) return [];
    return poolRaw.map(toQuizQuestion).filter((q) => subject === 'all' || q.subject === subject);
  }, [enabled, poolRaw, subject]);

  const combined = useMemo(() => [...mainBank, ...poolItems], [mainBank, poolItems]);

  return { mainBank, poolItems, combined, isPoolLoading, poolError };
}
