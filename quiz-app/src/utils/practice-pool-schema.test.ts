// schema validator 單元測試
import { describe, it, expect } from 'vitest';
import { validatePracticePool, assertPracticePoolValid } from './practice-pool-schema';
import poolJson from '../data/practice_pool.json';

describe('validatePracticePool — real data', () => {
  it('current practice_pool.json passes validation', () => {
    const errs = validatePracticePool(poolJson);
    if (errs.length > 0) {
      // 印出前幾個錯誤幫助 debug
      // eslint-disable-next-line no-console
      console.error(errs.slice(0, 5));
    }
    expect(errs).toEqual([]);
  });

  it('assertPracticePoolValid does not throw on real data', () => {
    expect(() => assertPracticePoolValid(poolJson)).not.toThrow();
  });
});

describe('validatePracticePool — synthetic invalid', () => {
  it('rejects non-object', () => {
    expect(validatePracticePool(null)).toContainEqual(
      expect.objectContaining({ path: '$' })
    );
  });

  it('rejects missing items array', () => {
    const errs = validatePracticePool({ _meta: { version: '1', totals: {} } });
    expect(errs.some((e) => e.path === 'items')).toBe(true);
  });

  it('detects ai_generated missing ai_metadata', () => {
    const bad = {
      _meta: { version: '1', totals: { total: 1 } },
      items: [
        {
          id: 'x',
          stem: 's',
          options: [
            { key: 'A', text: 'a' },
            { key: 'B', text: 'b' },
          ],
          answer: 'A',
          explanation: '',
          subject: null,
          topic_tags: [],
          difficulty: 'medium',
          sources: [],
          quality_flags: [],
          provenance: {
            source_type: 'ai_generated',
            source_origin: 'x',
            verified_date: '2026-04-25',
            verifier: 'x',
            verify_verdict: 'CONFIRMED',
            original_id: '1',
            // ai_metadata MISSING
          },
        },
      ],
    };
    const errs = validatePracticePool(bad);
    expect(errs.some((e) => e.path.includes('ai_metadata'))).toBe(true);
  });

  it('detects duplicate option keys', () => {
    const bad = {
      _meta: { version: '1', totals: { total: 1 } },
      items: [
        {
          id: 'x',
          stem: 's',
          options: [
            { key: 'A', text: 'a' },
            { key: 'A', text: 'duplicate' },
          ],
          answer: 'A',
          explanation: '',
          subject: null,
          topic_tags: [],
          difficulty: 'medium',
          sources: [],
          quality_flags: [],
          provenance: {
            source_type: 'external_mock',
            source_origin: 'x',
            verified_date: '2026-04-25',
            verifier: 'x',
            verify_verdict: 'CONFIRMED',
            original_id: '1',
          },
        },
      ],
    };
    const errs = validatePracticePool(bad);
    expect(errs.some((e) => e.message.includes('duplicate key'))).toBe(true);
  });

  it('detects invalid difficulty', () => {
    const bad = {
      _meta: { version: '1', totals: { total: 1 } },
      items: [
        {
          id: 'x',
          stem: 's',
          options: [
            { key: 'A', text: 'a' },
            { key: 'B', text: 'b' },
          ],
          answer: 'A',
          explanation: '',
          subject: null,
          topic_tags: [],
          difficulty: 'EXTREME',
          sources: [],
          quality_flags: [],
          provenance: {
            source_type: 'external_mock',
            source_origin: 'x',
            verified_date: '2026-04-25',
            verifier: 'x',
            verify_verdict: 'CONFIRMED',
            original_id: '1',
          },
        },
      ],
    };
    const errs = validatePracticePool(bad);
    expect(errs.some((e) => e.path.includes('difficulty'))).toBe(true);
  });

  it('detects total mismatch', () => {
    const bad = {
      _meta: { version: '1', totals: { total: 99 } },
      items: [], // total=99 but actual=0
    };
    const errs = validatePracticePool(bad);
    expect(errs.some((e) => e.path === '_meta.totals.total')).toBe(true);
  });
});
