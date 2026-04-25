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
    // 無答案題（exam mode 應排除）
    item(6, {
      subject: '考科一',
      answer: null,
    }),
  ];
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
