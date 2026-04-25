// 加強練習池工具：載入、過濾、normalize、轉換為 QuizQuestion
// 不直接依賴 React；可在 hook 與其他 utils 共用。

import practicePoolJson from '../data/practice_pool.json';
import type {
  PracticePool,
  PracticePoolItem,
  PracticePoolSourceType,
  PracticePoolDifficulty,
} from '../types/practicePool';
import type { QuizQuestion } from '../types/quiz';

// 直接強型別轉型（Vite/TS 對 JSON import 預設為 any-ish）
const POOL: PracticePool = practicePoolJson as unknown as PracticePool;

/** 取得整個練習池（含 _meta） */
export function getPracticePool(): PracticePool {
  return POOL;
}

/** 過濾條件 */
export interface PoolFilterOptions {
  sourceTypes?: PracticePoolSourceType[];
  topicTags?: string[];
  subjects?: Array<string | null>;
  difficulties?: PracticePoolDifficulty[];
  excludeFlags?: string[];
}

/** 將不同代理寫法的 topic tag 正規化（lowercased、移除空白與標點） */
export function normalizeTopicTag(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[　-〿＀-￯()（）「」『』、，。\.\-_/]/g, '');
}

/**
 * 根據條件過濾練習池。
 * - 任何 array 為空或 undefined 視為「不過濾此維度」
 * - excludeFlags 用於排除帶特定 quality_flag 的題（如 'time_sensitive'）
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

/**
 * Fisher-Yates shuffle in-place clone。確定性可選 seed（測試用）。
 */
export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 隨機抽樣 n 題（不重複）。若 items 不足 n，回傳全部。 */
export function randomSample<T>(items: T[], n: number, rng?: () => number): T[] {
  if (items.length <= n) return [...items];
  return shuffle(items, rng).slice(0, n);
}

/**
 * 把 PracticePoolItem 轉成現有 quiz 流程吃的 QuizQuestion 形狀。
 * UI 仍能透過 item.provenance / item.quality_flags 額外渲染來源徽章。
 */
export function toQuizQuestion(item: PracticePoolItem): QuizQuestion & {
  provenance: PracticePoolItem['provenance'];
  qualityFlags: PracticePoolItem['quality_flags'];
  sources: string[];
} {
  // subject 在練習池可能是中文「考科一/考科二」或 null；映射到既有 ExamSubject。
  let subject: QuizQuestion['subject'];
  const raw = item.subject ?? '';
  if (typeof raw === 'string' && raw.includes('1')) subject = '考科1';
  else if (typeof raw === 'string' && (raw.includes('一') || raw.toLowerCase().includes('subject 1')))
    subject = '考科1';
  else if (typeof raw === 'string' && raw.includes('2')) subject = '考科2';
  else if (typeof raw === 'string' && (raw.includes('二') || raw.toLowerCase().includes('subject 2')))
    subject = '考科2';
  else subject = '考科2'; // 大宗 fallback

  return {
    id: item.id,
    stem: item.stem,
    options: item.options,
    answer: item.answer,
    subject,
    sourceType: 'unique',
    year: null,
    hasAnswer: item.answer != null,
    provenance: item.provenance,
    qualityFlags: item.quality_flags,
    sources: item.sources,
  };
}

/** Convenience：依條件抽 n 題並轉換為 QuizQuestion 形狀 */
export function pickQuizQuestions(
  count: number,
  opts: PoolFilterOptions = {},
  rng?: () => number
): ReturnType<typeof toQuizQuestion>[] {
  const filtered = filterPool(POOL.items, opts);
  return randomSample(filtered, count, rng).map(toQuizQuestion);
}
