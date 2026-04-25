// 加強練習池 React hook：依過濾條件回傳題目陣列。
// 內部用 dynamic import 懶載入（170 KB JSON 不進 main bundle）

import { useEffect, useMemo, useState } from 'react';
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

/** 對 opts 做穩定 key，避免 caller 傳 literal 物件導致 useMemo 每次失效 */
function stableKey(opts: PoolFilterOptions): string {
  return JSON.stringify({
    sourceTypes: opts.sourceTypes ?? null,
    topicTags: opts.topicTags ?? null,
    subjects: opts.subjects ?? null,
    difficulties: opts.difficulties ?? null,
    excludeFlags: opts.excludeFlags ?? null,
  });
}

/** 從 stableKey 還原 opts（避免 render-time mutate ref 違反 React 18 純粹原則） */
function parseStableKey(key: string): PoolFilterOptions {
  try {
    const o = JSON.parse(key) as PoolFilterOptions & {
      sourceTypes: PoolFilterOptions['sourceTypes'] | null;
      topicTags: PoolFilterOptions['topicTags'] | null;
      subjects: PoolFilterOptions['subjects'] | null;
      difficulties: PoolFilterOptions['difficulties'] | null;
      excludeFlags: PoolFilterOptions['excludeFlags'] | null;
    };
    return {
      sourceTypes: o.sourceTypes ?? undefined,
      topicTags: o.topicTags ?? undefined,
      subjects: o.subjects ?? undefined,
      difficulties: o.difficulties ?? undefined,
      excludeFlags: o.excludeFlags ?? undefined,
    };
  } catch {
    return {};
  }
}

export function usePracticePool(opts: PoolFilterOptions = {}): UsePracticePoolResult {
  const [pool, setPool] = useState<PracticePool | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const key = stableKey(opts);

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

  // 純由 stable key 決定 — 避免 ref 在 render 期間 mutate
  const items = useMemo(
    () => (pool ? filterPool(pool.items, parseStableKey(key)) : []),
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
