import { describe, expect, it } from 'vitest';
import { buildFeedbackUrl } from './question-feedback-url';

describe('buildFeedbackUrl (#63)', () => {
  it('產生指向 issues/new 的 URL 並帶 template + q_id + q_stem + from_page', () => {
    const url = buildFeedbackUrl({
      questionId: 'gist-334',
      stem: 'ISSB S1 描述何者錯誤？',
      fromPage: 'quiz',
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(
      'https://github.com/thc1006/ipas-net-zero-quiz/issues/new'
    );
    expect(u.searchParams.get('template')).toBe('question-feedback.yml');
    expect(u.searchParams.get('q_id')).toBe('gist-334');
    expect(u.searchParams.get('q_stem')).toBe('ISSB S1 描述何者錯誤？');
    expect(u.searchParams.get('from_page')).toBe('quiz');
  });

  it('題幹超過 100 字會截斷並加省略號', () => {
    const longStem = 'A'.repeat(150);
    const url = buildFeedbackUrl({
      questionId: 'q-1',
      stem: longStem,
      fromPage: 'result',
    });
    const stem = new URL(url).searchParams.get('q_stem')!;
    expect(stem.length).toBe(101); // 100 + '…'
    expect(stem.endsWith('…')).toBe(true);
    expect(stem.startsWith('A'.repeat(100))).toBe(true);
  });

  it('題幹剛好 100 字不截斷不加省略號', () => {
    const exactStem = 'A'.repeat(100);
    const url = buildFeedbackUrl({
      questionId: 'q-1',
      stem: exactStem,
      fromPage: 'quiz',
    });
    const stem = new URL(url).searchParams.get('q_stem')!;
    expect(stem).toBe(exactStem);
    expect(stem.endsWith('…')).toBe(false);
  });

  it('題幹前後空白會 trim', () => {
    const url = buildFeedbackUrl({
      questionId: 'q-1',
      stem: '  題目開頭  ',
      fromPage: 'quiz',
    });
    expect(new URL(url).searchParams.get('q_stem')).toBe('題目開頭');
  });

  it('特殊字元（中文、&、=）正確 percent-encode', () => {
    const url = buildFeedbackUrl({
      questionId: 'p&q=1',
      stem: '依 IFRS S2 §15(a)',
      fromPage: 'result',
    });
    const u = new URL(url);
    // URLSearchParams 會自動正確 encode；URL 還原時 get() 回原值
    expect(u.searchParams.get('q_id')).toBe('p&q=1');
    expect(u.searchParams.get('q_stem')).toBe('依 IFRS S2 §15(a)');
    // 確認 raw URL 有 percent-encoding 而非裸字元
    expect(url).toMatch(/q_id=p%26q%3D1/);
  });
});
