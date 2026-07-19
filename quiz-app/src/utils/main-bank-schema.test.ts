// main-bank schema validator 測試
import { describe, it, expect } from 'vitest';
import { validateMainBank, assertMainBankValid } from './main-bank-schema';
import dataset from '../data/integrated_dataset.json';

describe('validateMainBank — real data', () => {
  it('current integrated_dataset.json passes validation', () => {
    const errs = validateMainBank(dataset);
    if (errs.length > 0) {
      console.error(errs.slice(0, 5));
    }
    expect(errs).toEqual([]);
  });

  it('assertMainBankValid does not throw', () => {
    expect(() => assertMainBankValid(dataset)).not.toThrow();
  });
});

describe('validateMainBank — synthetic invalid', () => {
  it('rejects null', () => {
    expect(validateMainBank(null)).toContainEqual(expect.objectContaining({ path: '$' }));
  });

  it('detects invalid exam_subject', () => {
    const bad = {
      meta: { total_questions: 1 },
      gist_items: [
        {
          index: 1,
          stem: 's',
          options: [{ key: 'A', text: 'a' }],
          answer: 'A',
          exam_subject: '考科3' as unknown as string, // invalid
        },
      ],
      our_unique_items: [],
    };
    const errs = validateMainBank(bad);
    expect(errs.some((e) => e.path.includes('exam_subject'))).toBe(true);
  });

  it('detects total mismatch', () => {
    const bad = {
      meta: { total_questions: 99 },
      gist_items: [],
      our_unique_items: [],
    };
    const errs = validateMainBank(bad);
    expect(errs.some((e) => e.path === 'meta.total_questions')).toBe(true);
  });
});
