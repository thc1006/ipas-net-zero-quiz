// Practice pool 數量單一事實來源
// UI 揭露文案禁止漂移到不同數字（EU AI Act Art.50 揭露對象需與實際 pool 一致）
//
// 來源：src/data/practice_pool.json `_meta.totals` + group-by subject
// 若 practice_pool.json 內容變動需同步更新此處（dev 啟動的 schema validator
// assert 內容形狀，cross-check test 驗證此常數與 _meta.totals 一致）
export const PRACTICE_POOL_COUNTS = {
  externalMock: 55,
  aiGenerated: 96,
  total: 151,
} as const;

/**
 * Pool 題依 subject filter 後的可抽題數
 *
 * - `考科1` / `考科2`: 該考科 mapped 的題目（不含 `unmapped_subject` flag）
 * - `all`: 全部 151 題（含 unmapped_subject）
 *
 * 來源計算（jq）：
 *   group_by(subject + "|" + provenance.source_type)
 *   - 考科一/ai_generated: 41
 *   - 考科二/ai_generated: 24
 *   - unknown/ai_generated: 31  (unmapped_subject flag — 只在 all 出現)
 *   - unknown/external_mock: 55 (unmapped_subject flag — 只在 all 出現)
 */
export const POOL_BY_SUBJECT = {
  '考科1': { externalMock: 0, aiGenerated: 41, total: 41 },
  '考科2': { externalMock: 0, aiGenerated: 24, total: 24 },
  all: { externalMock: 55, aiGenerated: 96, total: 151 },
} as const;
