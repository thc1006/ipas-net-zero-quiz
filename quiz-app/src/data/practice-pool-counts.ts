// Practice pool 數量單一事實來源
// UI 揭露文案禁止漂移到不同數字（EU AI Act Art.50 揭露對象需與實際 pool 一致）
//
// 來源：src/data/practice_pool.json `_meta.totals` + group-by subject
// 若 practice_pool.json 內容變動需同步更新此處（dev 啟動的 schema validator
// assert 內容形狀，cross-check test 驗證此常數與 _meta.totals 一致）
export const PRACTICE_POOL_COUNTS = {
  externalMock: 55,
  aiGenerated: 102,
  total: 157,
} as const;

/**
 * Pool 題依 subject filter 後的可抽題數
 *
 * Subject filter 邏輯（依 practice-pool.ts `getQuestionsForSubject`）：
 *   - `考科1` / `考科2`: 僅取 `item.subject` 以「考科一」/「考科二」開頭之題目
 *   - `all`: 全部 pool 題（含 subject 為 null 或非「考科一/二」字首者，均歸 unknown bucket）
 *
 * 來源計算（jq group_by(subject 字首 + "|" + provenance.source_type)）：
 *   - 考科一/ai_generated: 47  (+6 自 ifrs_s1_s2_round_2026q2)
 *   - 考科二/ai_generated: 24
 *   - unknown/ai_generated: 31  (subject 為 null 或非「考科一/二」字首；只在 all 出現)
 *   - unknown/external_mock: 55 (同上；只在 all 出現)
 */
export const POOL_BY_SUBJECT = {
  '考科1': { externalMock: 0, aiGenerated: 47, total: 47 },
  '考科2': { externalMock: 0, aiGenerated: 24, total: 24 },
  all: { externalMock: 55, aiGenerated: 102, total: 157 },
} as const;
