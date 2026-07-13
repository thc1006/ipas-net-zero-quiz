// Practice pool 數量單一事實來源
// UI 揭露文案禁止漂移到不同數字（EU AI Act Art.50 揭露對象需與實際 pool 一致）
//
// 來源：src/data/practice_pool.json `_meta.totals` + group-by subject
// 若 practice_pool.json 內容變動需同步更新此處（dev 啟動的 schema validator
// assert 內容形狀，cross-check test 驗證此常數與 _meta.totals 一致）
export const PRACTICE_POOL_COUNTS = {
  externalMock: 55,
  aiGenerated: 100,
  total: 155,
} as const;

/**
 * Pool 題依 subject filter 後的可抽題數
 *
 * Subject mapping & filter 實作位於 `utils/practice-pool.ts`：
 *   - `toQuizQuestion(item)` 將 `item.subject` 字串（如「考科一：...」）映射為
 *     QuizQuestion 的 subject 列舉（'考科1' / '考科2'）；映射不出則在 runtime
 *     注入 'unmapped_subject' quality flag（**JSON 不存此 flag**，是計算欄位）
 *   - `filterPool(items, opts)` 依 opts.subjects（PracticePoolItem.subject 原值）
 *     做精確 set-membership 過濾
 *
 * 下方數值之分組規則（jq group_by(subject 字首 + "|" + provenance.source_type)）：
 *   - 考科一/ai_generated: 47  (+6 自 ifrs_s1_s2_round_2026q2)
 *   - 考科二/ai_generated: 24
 *   - unknown/ai_generated: 31  (subject 為 null 或非「考科一/二」字首；只在 all 出現)
 *   - unknown/external_mock: 55 (同上；只在 all 出現)
 */
export const POOL_BY_SUBJECT = {
  '考科1': { externalMock: 0, aiGenerated: 47, total: 47 },
  '考科2': { externalMock: 0, aiGenerated: 24, total: 24 },
  all: { externalMock: 55, aiGenerated: 100, total: 155 },
} as const;
