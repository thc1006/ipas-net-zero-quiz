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

describe('validatePracticePool — additional invalid cases', () => {
  const validProvExternal = {
    source_type: 'external_mock',
    source_origin: 'x',
    verified_date: '2026-04-25',
    verifier: 'x',
    verify_verdict: 'CONFIRMED',
    original_id: '1',
  };

  it('detects missing provenance', () => {
    const bad = {
      _meta: { version: '1', totals: { total: 1 } },
      items: [
        {
          id: 'x',
          stem: 's',
          options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }],
          answer: 'A',
          explanation: '',
          subject: null,
          topic_tags: [],
          difficulty: 'medium',
          sources: [],
          quality_flags: [],
          // provenance missing
        },
      ],
    };
    const errs = validatePracticePool(bad);
    expect(errs.some((e) => e.path.includes('provenance'))).toBe(true);
  });

  it('detects empty options array', () => {
    const bad = {
      _meta: { version: '1', totals: { total: 1 } },
      items: [
        {
          id: 'x',
          stem: 's',
          options: [],
          answer: null,
          explanation: '',
          subject: null,
          topic_tags: [],
          difficulty: 'medium',
          sources: [],
          quality_flags: [],
          provenance: validProvExternal,
        },
      ],
    };
    const errs = validatePracticePool(bad);
    expect(errs.some((e) => e.path.includes('options') && /non-empty/.test(e.message))).toBe(true);
  });

  // quality_flags / sources 不是陣列時，共用完整性規則的 adapter 會退回成空陣列。
  // 這條測試證明它「優雅降級」而不是丟例外 —— schema 的工作是把所有問題「列出來」，
  // 而不是在第一個壞欄位就炸掉、讓後面的問題永遠看不到。
  it('quality_flags / sources 不是陣列時仍能完成驗證（不丟例外，且照樣列出其他錯誤）', () => {
    const bad = {
      _meta: { version: '1', totals: { total: 1 } },
      items: [
        {
          id: 'malformed-arrays',
          stem: '題幹',
          options: [
            { key: 'A', text: 'a' },
            { key: 'B', text: 'b' },
            { key: 'C', text: 'c' },
            { key: 'D', text: 'd' },
          ],
          answer: 'Z', // 同時是錯的 —— 要證明後面的規則仍然跑得到
          explanation: 'e',
          subject: null,
          topic_tags: [],
          difficulty: 'medium',
          sources: 'https://example.com' as unknown as string[], // 不是陣列
          quality_flags: 'time_sensitive' as unknown as string[], // 不是陣列
          provenance: validProvExternal,
        },
      ],
    };

    let errs: ReturnType<typeof validatePracticePool> = [];
    expect(() => {
      errs = validatePracticePool(bad);
    }).not.toThrow();

    // 型別錯誤本身要報
    expect(errs.some((e) => e.path.endsWith('.sources'))).toBe(true);
    expect(errs.some((e) => e.path.endsWith('.quality_flags'))).toBe(true);
    // 而且共用規則仍然跑得到 —— answer=Z 不在選項裡
    expect(errs.some((e) => e.path.includes('answer_not_in_options'))).toBe(true);
  });

  it('detects non-string subject (number)', () => {
    const bad = {
      _meta: { version: '1', totals: { total: 1 } },
      items: [
        {
          id: 'x',
          stem: 's',
          options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }],
          answer: 'A',
          explanation: '',
          subject: 42, // invalid type
          topic_tags: [],
          difficulty: 'medium',
          sources: [],
          quality_flags: [],
          provenance: validProvExternal,
        },
      ],
    };
    const errs = validatePracticePool(bad);
    expect(errs.some((e) => e.path.includes('subject'))).toBe(true);
  });

  it('detects ai_metadata missing verifier_round', () => {
    const bad = {
      _meta: { version: '1', totals: { total: 1 } },
      items: [
        {
          id: 'x',
          stem: 's',
          options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }],
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
            ai_metadata: {
              model_family: 'unspecified',
              generation_date: '2026-04-25',
              // verifier_round missing
            },
          },
        },
      ],
    };
    const errs = validatePracticePool(bad);
    expect(errs.some((e) => e.path.includes('verifier_round'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verdict 不得與題目自身狀態矛盾
//
// 實際踩到的坑：兩題 PAS 2060 撤回日期題（來源互相矛盾、無法唯一作答）已經被設成
// answer=null + quality_flags:['ambiguous']（排除計分），但 provenance.verify_verdict
// 卻還留著 'CONFIRMED' —— provenance 宣稱「已驗證確認」，而題目正是因為驗不出來
// 才被排除。這兩件事不可能同時為真，而在此之前沒有任何規則擋得住。
//
// 為什麼要擋：provenance 是拿來被信任的。日後任何人或任何腳本只要相信
// verify_verdict，就會把這題當成已驗證的好題重新啟用。說謊的 provenance 比沒有還糟。
//
// 兩面都測：髒資料必須報錯，乾淨資料不得誤報。
describe('validatePracticePool — verdict 與 quality_flags/answer 的一致性', () => {
  const baseProv = {
    source_type: 'external_mock',
    source_origin: 'x',
    verified_date: '2026-04-25',
    verifier: 'x',
    original_id: '1',
  };

  const wrap = (item: Record<string, unknown>) => ({
    _meta: { version: '1', totals: { total: 1 } },
    items: [
      {
        id: 'x',
        stem: '題幹',
        options: [
          { key: 'A', text: 'a' },
          { key: 'B', text: 'b' },
        ],
        explanation: '',
        subject: null,
        topic_tags: [],
        difficulty: 'medium',
        sources: [],
        ...item,
      },
    ],
  });

  const verdictErrs = (pool: unknown) =>
    validatePracticePool(pool).filter((e) => e.path.includes('verify_verdict'));

  it('ambiguous + CONFIRMED → 報錯（PAS 2060 那兩題原本的狀態）', () => {
    const errs = verdictErrs(
      wrap({
        answer: null,
        quality_flags: ['ambiguous'],
        provenance: { ...baseProv, verify_verdict: 'CONFIRMED' },
      })
    );
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].message).toMatch(/矛盾|AMBIGUOUS/);
  });

  it('ambiguous + AMBIGUOUS + answer=null → 通過（修好之後的正確狀態）', () => {
    expect(
      verdictErrs(
        wrap({
          answer: null,
          quality_flags: ['ambiguous'],
          provenance: {
            ...baseProv,
            verify_verdict: 'AMBIGUOUS',
            prior_verify_verdict: 'CONFIRMED',
          },
        })
      )
    ).toEqual([]);
  });

  it('verdict=AMBIGUOUS 但沒有 ambiguous flag → 報錯（題目仍會被正常計分）', () => {
    const errs = verdictErrs(
      wrap({
        answer: 'A',
        quality_flags: [],
        provenance: { ...baseProv, verify_verdict: 'AMBIGUOUS' },
      })
    );
    expect(errs.length).toBeGreaterThan(0);
  });

  it('verdict=AMBIGUOUS 卻仍給出答案 → 報錯（驗不出來就不能教確定答案）', () => {
    const errs = verdictErrs(
      wrap({
        answer: 'A',
        quality_flags: ['ambiguous'],
        provenance: { ...baseProv, verify_verdict: 'AMBIGUOUS' },
      })
    );
    expect(errs.some((e) => /仍給出答案/.test(e.message))).toBe(true);
  });

  it('一般題（有答案、無 ambiguous、CONFIRMED）→ 不得誤報', () => {
    expect(
      verdictErrs(
        wrap({
          answer: 'A',
          quality_flags: [],
          provenance: { ...baseProv, verify_verdict: 'CONFIRMED' },
        })
      )
    ).toEqual([]);
  });

  it('time_sensitive 但非 ambiguous 的 CONFIRMED 題 → 不得誤報', () => {
    expect(
      verdictErrs(
        wrap({
          answer: 'A',
          quality_flags: ['time_sensitive'],
          sources: ['https://example.org/spec'],
          provenance: { ...baseProv, verify_verdict: 'CONFIRMED' },
        })
      )
    ).toEqual([]);
  });

  it('prior_verify_verdict 值不合法 → 報錯', () => {
    const errs = validatePracticePool(
      wrap({
        answer: 'A',
        quality_flags: [],
        provenance: {
          ...baseProv,
          verify_verdict: 'CONFIRMED',
          prior_verify_verdict: 'NOT_A_VERDICT',
        },
      })
    );
    expect(errs.some((e) => e.path.includes('prior_verify_verdict'))).toBe(true);
  });
});
