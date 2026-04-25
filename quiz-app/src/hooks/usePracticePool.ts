// 加強練習池 React hook：依過濾條件回傳題目陣列。
// 內部不做網路請求 — 練習池為 static import；hook 僅作 memoized filter / sample。

import { useMemo } from 'react';
import {
  filterPool,
  getPracticePool,
  pickQuizQuestions,
  type PoolFilterOptions,
} from '../utils/practice-pool';
import type { PracticePool, PracticePoolItem } from '../types/practicePool';

interface UsePracticePoolResult {
  pool: PracticePool;
  items: PracticePoolItem[];
  totalCount: number;
}

/**
 * 取得練習池內容並依條件過濾。
 * - 不抽樣（保留原順序）；如需隨機，請呼叫 pickQuizQuestions util。
 */
export function usePracticePool(opts: PoolFilterOptions = {}): UsePracticePoolResult {
  const pool = useMemo(() => getPracticePool(), []);
  const items = useMemo(() => filterPool(pool.items, opts), [pool.items, opts]);
  return {
    pool,
    items,
    totalCount: items.length,
  };
}

export { pickQuizQuestions };
