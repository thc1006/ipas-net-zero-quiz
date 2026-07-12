// 練習池 schema 輕量驗證器
// 採純 TS（不引 zod 等新依賴）；用於 dev / test 抓 schema 漂移
// 失敗時回傳錯誤陣列；caller 決定 throw 或 console.warn

import type {
  PracticePool,
  PracticePoolItem,
  PracticePoolSourceType,
  PracticePoolDifficulty,
  PracticePoolVerdict,
  PracticePoolQualityFlag,
} from '../types/practicePool';
// 與主題庫共用的完整性規則（四選一 A–D、答案存在且在選項內、無換行/PDF 頁首頁尾、
// time_sensitive 必須有可驗證來源）。抽出來共用，兩個題庫才是同一把尺。
import { checkQuestion } from './question-integrity';

const SOURCE_TYPES: ReadonlyArray<PracticePoolSourceType> = ['external_mock', 'ai_generated'];
const DIFFICULTIES: ReadonlyArray<PracticePoolDifficulty> = ['easy', 'medium', 'hard'];
const VERDICTS: ReadonlyArray<PracticePoolVerdict> = [
  'CONFIRMED',
  'AMBIGUOUS',
  'TIME_SENSITIVE',
  'OUTDATED_SOURCE',
  'HALLUCINATED',
  'REFUTED',
  'DUPLICATE',
];
const QUALITY_FLAGS: ReadonlyArray<PracticePoolQualityFlag> = [
  'time_sensitive',
  'ambiguous',
  'low_confidence',
  'duplicate_topic',
];

export interface ValidationError {
  path: string;
  message: string;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}
function isOneOf<T extends string>(v: unknown, allowed: ReadonlyArray<T>): v is T {
  return typeof v === 'string' && (allowed as ReadonlyArray<string>).includes(v);
}

function validateItem(it: unknown, idx: number, errs: ValidationError[]): void {
  const path = `items[${idx}]`;
  if (!isObj(it)) {
    errs.push({ path, message: 'not an object' });
    return;
  }

  if (typeof it.id !== 'string' || !it.id) errs.push({ path: `${path}.id`, message: 'missing/empty' });
  if (typeof it.stem !== 'string' || !it.stem) errs.push({ path: `${path}.stem`, message: 'missing/empty' });

  if (!Array.isArray(it.options) || it.options.length === 0) {
    errs.push({ path: `${path}.options`, message: 'must be non-empty array' });
  } else {
    const seenKeys = new Set<string>();
    it.options.forEach((o: unknown, oi) => {
      if (!isObj(o) || typeof o.key !== 'string' || typeof o.text !== 'string') {
        errs.push({ path: `${path}.options[${oi}]`, message: 'must be {key:string, text:string}' });
        return;
      }
      if (seenKeys.has(o.key)) errs.push({ path: `${path}.options`, message: `duplicate key ${o.key}` });
      seenKeys.add(o.key);
    });
  }

  if (it.answer !== null && typeof it.answer !== 'string') {
    errs.push({ path: `${path}.answer`, message: 'must be string|null' });
  }

  if (typeof it.explanation !== 'string') {
    errs.push({ path: `${path}.explanation`, message: 'must be string' });
  }

  if (it.subject !== null && typeof it.subject !== 'string') {
    errs.push({ path: `${path}.subject`, message: 'must be string|null' });
  }

  if (!isStringArray(it.topic_tags)) {
    errs.push({ path: `${path}.topic_tags`, message: 'must be string[]' });
  }

  if (!isOneOf(it.difficulty, DIFFICULTIES)) {
    errs.push({ path: `${path}.difficulty`, message: `must be one of ${DIFFICULTIES.join('|')}` });
  }

  if (!isStringArray(it.sources)) {
    errs.push({ path: `${path}.sources`, message: 'must be string[]' });
  }

  if (!Array.isArray(it.quality_flags) || !it.quality_flags.every((f) => isOneOf(f, QUALITY_FLAGS))) {
    errs.push({ path: `${path}.quality_flags`, message: `must be array of ${QUALITY_FLAGS.join('|')}` });
  }

  // provenance 是 discriminated union — ai_generated 必帶 ai_metadata
  const prov = it.provenance;
  if (!isObj(prov)) {
    errs.push({ path: `${path}.provenance`, message: 'missing or not object' });
    return;
  }
  if (!isOneOf(prov.source_type, SOURCE_TYPES)) {
    errs.push({
      path: `${path}.provenance.source_type`,
      message: `must be one of ${SOURCE_TYPES.join('|')}`,
    });
  }
  if (!isOneOf(prov.verify_verdict, VERDICTS)) {
    errs.push({
      path: `${path}.provenance.verify_verdict`,
      message: `must be one of ${VERDICTS.join('|')}`,
    });
  }
  for (const k of ['source_origin', 'verified_date', 'verifier', 'original_id'] as const) {
    if (typeof prov[k] !== 'string' || !prov[k]) {
      errs.push({ path: `${path}.provenance.${k}`, message: 'missing/empty' });
    }
  }
  if (prov.source_type === 'ai_generated') {
    const ai = prov.ai_metadata;
    if (!isObj(ai)) {
      errs.push({
        path: `${path}.provenance.ai_metadata`,
        message: 'ai_generated requires ai_metadata',
      });
    } else {
      if (typeof ai.model_family !== 'string') {
        errs.push({ path: `${path}.provenance.ai_metadata.model_family`, message: 'must be string' });
      }
      if (typeof ai.generation_date !== 'string') {
        errs.push({
          path: `${path}.provenance.ai_metadata.generation_date`,
          message: 'must be string',
        });
      }
      if (typeof ai.verifier_round !== 'number') {
        errs.push({
          path: `${path}.provenance.ai_metadata.verifier_round`,
          message: 'must be number',
        });
      }
    }
  }

  // ---- 共用完整性規則（與主題庫同一套，見 utils/question-integrity.ts）----
  //
  // 這個 schema 原本只驗「形狀」：options 是非空陣列、有 key/text、answer 是 string|null…
  // 它擋不住這個專案正在對付的那類錯誤 —— 實測把一筆雙欄錯置樣式的髒資料塞進練習池
  // （3 個選項、內嵌換行、PDF 頁首頁尾、answer='Z' 不在選項裡、sources=['not-a-url']、
  // 標了 time_sensitive 卻無可驗證來源），全套測試沒有任何一條抓到。
  //
  // 規則抽出來共用，dev 啟動的 fail-fast 與 CI gate 才是同一把尺。
  if (typeof it.stem === 'string' && Array.isArray(it.options)) {
    const opts = it.options.filter(
      (o: unknown): o is { key: string; text: string } =>
        isObj(o) && typeof o.key === 'string' && typeof o.text === 'string'
    );
    // 選項形狀本身壞掉時上面已經報過了，這裡只在形狀可解析時跑語意規則
    if (opts.length === it.options.length) {
      for (const v of checkQuestion({
        id: typeof it.id === 'string' ? it.id : path,
        stem: it.stem,
        options: opts,
        answer: (it.answer ?? null) as string | null,
        qualityFlags: Array.isArray(it.quality_flags)
          ? (it.quality_flags.filter((f) => typeof f === 'string') as string[])
          : [],
        sourceUrls: Array.isArray(it.sources)
          ? (it.sources.filter((u) => typeof u === 'string') as string[])
          : [],
      })) {
        errs.push({ path: `${path}.${v.rule}`, message: v.detail });
      }
    }
  }
}

/**
 * 驗證練習池整體結構與每筆 item。回傳錯誤清單；空陣列 = 通過。
 * 不會 throw；caller 自行決定處理（dev/test → throw、prod → warn）
 */
export function validatePracticePool(pool: unknown): ValidationError[] {
  const errs: ValidationError[] = [];

  if (!isObj(pool)) {
    errs.push({ path: '$', message: 'not an object' });
    return errs;
  }

  if (!isObj(pool._meta)) {
    errs.push({ path: '_meta', message: 'missing or not object' });
  } else {
    const meta = pool._meta;
    if (typeof meta.version !== 'string') errs.push({ path: '_meta.version', message: 'must be string' });
    if (!isObj(meta.totals)) errs.push({ path: '_meta.totals', message: 'must be object' });
  }

  if (!Array.isArray(pool.items)) {
    errs.push({ path: 'items', message: 'must be array' });
    return errs;
  }

  pool.items.forEach((it, i) => validateItem(it, i, errs));

  // _meta.totals 與 items 數量一致
  const meta = (pool as { _meta?: { totals?: { total?: number } } })._meta;
  if (meta?.totals?.total != null && meta.totals.total !== pool.items.length) {
    errs.push({
      path: '_meta.totals.total',
      message: `mismatch: meta=${meta.totals.total} actual=${pool.items.length}`,
    });
  }

  return errs;
}

/**
 * Dev-only assert：失敗時 throw with 詳細路徑。
 * Caller 通常在啟動時呼叫；production build 不會 throw（只 warn）。
 */
export function assertPracticePoolValid(pool: unknown): asserts pool is PracticePool {
  const errs = validatePracticePool(pool);
  if (errs.length > 0) {
    const env = (import.meta as ImportMeta).env;
    const summary = errs
      .slice(0, 10)
      .map((e) => `  ${e.path}: ${e.message}`)
      .join('\n');
    const msg = `practice_pool schema validation failed (${errs.length} error${errs.length > 1 ? 's' : ''}):\n${summary}${errs.length > 10 ? `\n  ...and ${errs.length - 10} more` : ''}`;
    if (env?.PROD) {
      // production：不 throw（避免使用者看到白屏）；只 warn
      // eslint-disable-next-line no-console
      console.warn(msg);
    } else {
      throw new Error(msg);
    }
  }
}

// 為下游 type narrowing 而 export 既有型別
export type { PracticePool, PracticePoolItem };
