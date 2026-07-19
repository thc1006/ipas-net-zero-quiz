// 主題庫（integrated_dataset.json）schema 輕量驗證
// 同 practice-pool-schema 風格；純 TS 無新依賴

import type {
  QuizDataset,
  GistQuestion,
  UniqueQuestion,
  ExamSubject,
} from '../types/quiz';

const EXAM_SUBJECTS: ReadonlyArray<ExamSubject> = ['考科1', '考科2'];

export interface MainBankValidationError {
  path: string;
  message: string;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isExamSubject(v: unknown): v is ExamSubject {
  return typeof v === 'string' && (EXAM_SUBJECTS as ReadonlyArray<string>).includes(v);
}

function validateGist(g: unknown, idx: number, errs: MainBankValidationError[]): void {
  const path = `gist_items[${idx}]`;
  if (!isObj(g)) {
    errs.push({ path, message: 'not an object' });
    return;
  }
  if (typeof g.index !== 'number') errs.push({ path: `${path}.index`, message: 'must be number' });
  if (typeof g.stem !== 'string' || !g.stem) errs.push({ path: `${path}.stem`, message: 'missing/empty' });
  if (!Array.isArray(g.options) || g.options.length === 0) {
    errs.push({ path: `${path}.options`, message: 'must be non-empty array' });
  }
  if (g.answer !== null && typeof g.answer !== 'string') {
    errs.push({ path: `${path}.answer`, message: 'must be string|null' });
  }
  if (!isExamSubject(g.exam_subject)) {
    errs.push({ path: `${path}.exam_subject`, message: `must be one of ${EXAM_SUBJECTS.join('|')}` });
  }
}

function validateUnique(u: unknown, idx: number, errs: MainBankValidationError[]): void {
  const path = `our_unique_items[${idx}]`;
  if (!isObj(u)) {
    errs.push({ path, message: 'not an object' });
    return;
  }
  if (typeof u.item_id !== 'string' || !u.item_id) errs.push({ path: `${path}.item_id`, message: 'missing/empty' });
  if (typeof u.stem !== 'string' || !u.stem) errs.push({ path: `${path}.stem`, message: 'missing/empty' });
  if (!Array.isArray(u.options) || u.options.length === 0) {
    errs.push({ path: `${path}.options`, message: 'must be non-empty array' });
  }
  if (!isExamSubject(u.exam_subject)) {
    errs.push({ path: `${path}.exam_subject`, message: `must be one of ${EXAM_SUBJECTS.join('|')}` });
  }
}

export function validateMainBank(ds: unknown): MainBankValidationError[] {
  const errs: MainBankValidationError[] = [];
  if (!isObj(ds)) {
    errs.push({ path: '$', message: 'not an object' });
    return errs;
  }
  if (!isObj(ds.meta)) errs.push({ path: 'meta', message: 'missing or not object' });
  if (!Array.isArray(ds.gist_items)) {
    errs.push({ path: 'gist_items', message: 'must be array' });
  } else {
    ds.gist_items.forEach((g, i) => validateGist(g, i, errs));
  }
  if (!Array.isArray(ds.our_unique_items)) {
    errs.push({ path: 'our_unique_items', message: 'must be array' });
  } else {
    ds.our_unique_items.forEach((u, i) => validateUnique(u, i, errs));
  }
  // meta.total_questions vs actual count
  const meta = (ds as { meta?: { total_questions?: number } }).meta;
  if (
    isObj(meta) &&
    typeof meta.total_questions === 'number' &&
    Array.isArray(ds.gist_items) &&
    Array.isArray(ds.our_unique_items)
  ) {
    const actual = ds.gist_items.length + ds.our_unique_items.length;
    if (meta.total_questions !== actual) {
      errs.push({
        path: 'meta.total_questions',
        message: `mismatch: meta=${meta.total_questions} actual=${actual}`,
      });
    }
  }
  return errs;
}

export function assertMainBankValid(ds: unknown): asserts ds is QuizDataset {
  const errs = validateMainBank(ds);
  if (errs.length > 0) {
    const env = (import.meta as ImportMeta).env;
    const summary = errs.slice(0, 10).map((e) => `  ${e.path}: ${e.message}`).join('\n');
    const msg = `main-bank schema validation failed (${errs.length} error${errs.length > 1 ? 's' : ''}):\n${summary}${errs.length > 10 ? `\n  ...and ${errs.length - 10} more` : ''}`;
    if (env?.PROD) {
      console.warn(msg);
    } else {
      throw new Error(msg);
    }
  }
}

export type { GistQuestion, UniqueQuestion };
