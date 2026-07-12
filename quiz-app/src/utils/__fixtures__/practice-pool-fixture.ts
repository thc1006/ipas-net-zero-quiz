// 測試用 practice pool fixture
// 提供小型穩定資料集給整合測試（startQuizWithPool / useQuizSource），
// 避免依賴 dynamic import('../data/practice_pool.json') 的時序敏感性。
//
// 結構保持與 practice_pool.json 一致（PracticePool type）；
// 內容刻意涵蓋三種 subject 邊界 + 兩種 source_type + 一筆 unmapped_subject。
import type { PracticePool, PracticePoolItem } from '../../types/practicePool';

const aiMeta = {
  model_family: 'unspecified' as const,
  generation_date: '2026-04-25',
  verifier_round: 1 as const,
};

function item(
  i: number,
  overrides: Partial<PracticePoolItem>,
): PracticePoolItem {
  return {
    id: `fixture-${i}`,
    stem: `Fixture 題目 ${i}：請選擇正確答案`,
    options: [
      { key: 'A', text: '選 A' },
      { key: 'B', text: '選 B' },
      { key: 'C', text: '選 C' },
      { key: 'D', text: '選 D' },
    ],
    answer: 'A',
    explanation: 'fixture explanation',
    subject: '考科一',
    topic_tags: [],
    difficulty: 'medium',
    provenance: {
      source_type: 'external_mock',
      source_origin: 'fixture',
      verified_date: '2026-04-25',
      verifier: 'fixture',
      verify_verdict: 'CONFIRMED',
      original_id: `fix-${i}`,
    },
    sources: [],
    quality_flags: [],
    ...overrides,
  };
}

/**
 * fixture 裡「刻意沒有答案」的那一題（answer=null + ambiguous）。
 *
 * 之所以要匯出成常數：nullAnswerScoring 那組測試的鑑別力**全部**押在這一題身上。
 * 一旦有人把它從 fixture 拿掉，「exam mode 不得出現無答案題」那條會**靜默變綠**
 * （`expect(ids).not.toContain(...)` 與 `for (…) expect(hasAnswer).toBe(true)`
 *  在沒有無答案題時都是空轉），而測試看起來仍然是綠的。
 *
 * 現在測試會先斷言這一題確實在池子裡，拿掉它就會直接紅。
 */
export const FIXTURE_NULL_ANSWER_ID = 'fixture-6';

export function buildFixturePool(): PracticePool {
  const items: PracticePoolItem[] = [
    // 考科一 mapped, external_mock, 有答案
    item(1, { subject: '考科一' }),
    item(2, { subject: '考科一' }),
    // 考科二 mapped, ai_generated, 有答案
    item(3, {
      subject: '考科二',
      provenance: {
        source_type: 'ai_generated',
        source_origin: 'fixture-ai',
        verified_date: '2026-04-25',
        verifier: 'fixture',
        verify_verdict: 'CONFIRMED',
        original_id: 'fix-ai-3',
        ai_metadata: aiMeta,
      },
    }),
    item(4, {
      subject: '考科二',
      provenance: {
        source_type: 'ai_generated',
        source_origin: 'fixture-ai',
        verified_date: '2026-04-25',
        verifier: 'fixture',
        verify_verdict: 'CONFIRMED',
        original_id: 'fix-ai-4',
        ai_metadata: aiMeta,
      },
    }),
    // unmapped subject → 取得 unmapped_subject flag
    item(5, {
      subject: null,
      quality_flags: ['unmapped_subject'],
    }),
    // 無答案題 —— 模擬真實資料中「來源互相矛盾、刻意排除計分」的題目
    // （例：PAS 2060 撤回日期）。answer=null 必須同時標 ambiguous，
    // 否則會違反 question-integrity 的 missing_answer 規則。
    // exam mode 應完全排除它；practice mode 可以出現，但絕不可計分。
    item(6, {
      subject: '考科一',
      answer: null,
      quality_flags: ['ambiguous'],
    }),
  ];

  // fixture 自我檢查：那題「刻意沒有答案」的題目必須真的在池子裡，
  // 否則所有依賴它的測試都會安靜地失去鑑別力。
  if (!items.some((i) => i.id === FIXTURE_NULL_ANSWER_ID && i.answer === null)) {
    throw new Error(
      `fixture 壞了：找不到 ${FIXTURE_NULL_ANSWER_ID}（answer=null）。` +
        'nullAnswerScoring 那組測試的鑑別力全部押在它身上。'
    );
  }

  return {
    _meta: {
      version: 'fixture',
      generated_at: '2026-04-25',
      description: 'test fixture',
      source_types: ['external_mock', 'ai_generated'],
      compliance: {
        eu_ai_act_art50_effective: '2026-08-02',
        ai_generated_disclosure: 'fixture',
      },
      totals: { external_mock: 4, ai_generated: 2, total: 6 },
      policy: 'fixture',
    },
    items,
  };
}
