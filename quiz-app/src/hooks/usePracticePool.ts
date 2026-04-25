// 加強練習池 React hook：依過濾條件回傳題目陣列。
// 內部用 dynamic import 懶載入（170 KB JSON 不進 main bundle）

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  filterPool,
  loadPracticePool,
  pickQuizQuestions,
  type PoolFilterOptions,
} from '../utils/practice-pool';
import type { PracticePool, PracticePoolItem } from '../types/practicePool';

interface UsePracticePoolResult {
  pool: PracticePool | null;
  items: PracticePoolItem[];
  totalCount: number;
  isLoading: boolean;
  error: Error | null;
}

/** 對 opts 做淺比較，避免 caller 傳 literal 物件導致 useMemo 每次失效 */
function stableKey(opts: PoolFilterOptions): string {
  return JSON.stringify({
    sourceTypes: opts.sourceTypes ?? null,
    topicTags: opts.topicTags ?? null,
    subjects: opts.subjects ?? null,
    difficulties: opts.difficulties ?? null,
    excludeFlags: opts.excludeFlags ?? null,
  });
}

export function usePracticePool(opts: PoolFilterOptions = {}): UsePracticePoolResult {
  const [pool, setPool] = useState<PracticePool | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const key = stableKey(opts);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    loadPracticePool()
      .then((p) => {
        if (!cancelled) {
          setPool(p);
          setIsLoading(false);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e);
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(
    () => (pool ? filterPool(pool.items, optsRef.current) : []),
    [pool, key]
  );

  return {
    pool,
    items,
    totalCount: items.length,
    isLoading,
    error,
  };
}

export { pickQuizQuestions };
