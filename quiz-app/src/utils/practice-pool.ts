// 加強練習池工具：lazy 載入、過濾、normalize、轉換為 QuizQuestion
// 不直接依賴 React；可在 hook 與其他 utils 共用。

import type {
  PracticePool,
  PracticePoolItem,
  PracticePoolSourceType,
  PracticePoolDifficulty,
} from '../types/practicePool';
import type { QuizQuestion } from '../types/quiz';

// Lazy load: 使用 dynamic import 避免 170 KB 常駐於 main bundle
// Vite 會自動拆 chunk；僅在第一次 callers 呼叫 loadPracticePool 時載入
let poolPromise: Promise<PracticePool> | null = null;
/** 同步 cache：透過 loadPracticePool 與 prefetchPracticePool 都會寫入 */
let poolCached: PracticePool | null = null;

export function loadPracticePool(): Promise<PracticePool> {
  if (!poolPromise) {
    poolPromise = import('../data/practice_pool.json').then((m) => {
      const pool = m.default as unknown as PracticePool;
      poolCached = pool;
      return pool;
    });
  }
  return poolPromise;
}

/** 供同步 caller（已確認 pool 載入完成）存取已快取的 pool */
export function getPracticePoolSync(): PracticePool | null {
  return poolCached;
}

/** 預載入（UI 可於 opt-in 時呼叫，讓 quiz 啟動前 chunk 已進快取） */
export async function prefetchPracticePool(): Promise<PracticePool> {
  return loadPracticePool();
}

/** 過濾條件 */
export interface PoolFilterOptions {
  sourceTypes?: PracticePoolSourceType[];
  topicTags?: string[];
  subjects?: Array<string | null>;
  difficulties?: PracticePoolDifficulty[];
  excludeFlags?: string[];
}

/**
 * 將不同代理寫法的 topic tag 正規化。
 * - 移除空白、常見標點（半形 + 全形 + CJK）
 * - 轉小寫
 */
export function normalizeTopicTag(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[　-〿＀-￯()（）「」『』、，。,;:!?！？\.\-_/]/g, '');
}

/**
 * 根據條件過濾練習池。
 */
export function filterPool(
  items: PracticePoolItem[],
  opts: PoolFilterOptions = {}
): PracticePoolItem[] {
  const sourceSet = opts.sourceTypes && new Set(opts.sourceTypes);
  const tagSet = opts.topicTags && new Set(opts.topicTags.map(normalizeTopicTag));
  const subjectSet = opts.subjects && new Set(opts.subjects);
  const diffSet = opts.difficulties && new Set(opts.difficulties);
  const excludeFlagSet = opts.excludeFlags && new Set(opts.excludeFlags);

  return items.filter((it) => {
    if (sourceSet && !sourceSet.has(it.provenance.source_type)) return false;
    if (subjectSet && !subjectSet.has(it.subject ?? null)) return false;
    if (diffSet && !diffSet.has(it.difficulty)) return false;
    if (tagSet) {
      const itemTags = it.topic_tags.map(normalizeTopicTag);
      if (!itemTags.some((t) => tagSet.has(t))) return false;
    }
    if (excludeFlagSet) {
      if (it.quality_flags.some((f) => excludeFlagSet.has(f))) return false;
    }
    return true;
  });
}

/** Fisher-Yates shuffle */
export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 隨機抽樣 n 題 */
export function randomSample<T>(items: T[], n: number, rng?: () => number): T[] {
  if (items.length <= n) return [...items];
  return shuffle(items, rng).slice(0, n);
}

/** 把 PracticePoolItem 轉成 QuizQuestion 形狀 */
export function toQuizQuestion(item: PracticePoolItem): QuizQuestion & {
  provenance: PracticePoolItem['provenance'];
  qualityFlags: PracticePoolItem['quality_flags'];
  sources: string[];
} {
  const raw = typeof item.subject === 'string' ? item.subject : '';
  let subject: QuizQuestion['subject'] | null = null;
  if (raw.includes('1') || raw.includes('一') || raw.toLowerCase().includes('subject 1')) {
    subject = '考科1';
  } else if (raw.includes('2') || raw.includes('二') || raw.toLowerCase().includes('subject 2')) {
    subject = '考科2';
  }
  if (subject === null && item.subject !== null && import.meta.env?.DEV) {
    // eslint-disable-next-line no-console
    console.warn(`[practice-pool] 題 ${item.id} subject 值無法映射：`, item.subject);
  }

  return {
    id: item.id,
    stem: item.stem,
    options: item.options,
    answer: item.answer,
    subject: subject ?? '考科2',
    sourceType: 'practice_pool',
    year: null,
    hasAnswer: item.answer != null,
    provenance: item.provenance,
    qualityFlags: item.quality_flags,
    sources: item.sources,
  };
}

/** Convenience：依條件抽 n 題並轉換為 QuizQuestion 形狀（async） */
export async function pickQuizQuestions(
  count: number,
  opts: PoolFilterOptions = {},
  rng?: () => number
): Promise<ReturnType<typeof toQuizQuestion>[]> {
  const pool = await loadPracticePool();
  const filtered = filterPool(pool.items, opts);
  return randomSample(filtered, count, rng).map(toQuizQuestion);
}

/** 測試專用：重置 lazy-loaded promise cache（勿於 production 使用） */
export function __resetPracticePoolCacheForTesting(): void {
  // 僅供測試環境（vitest）；production build 呼叫會 no-op
  const env = (import.meta as ImportMeta).env;
  if (env?.PROD) return;
  poolPromise = null;
  poolCached = null;
}
