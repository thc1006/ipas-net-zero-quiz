// Practice pool 數量單一事實來源
// UI 揭露文案禁止漂移到不同數字（EU AI Act Art.50 揭露對象需與實際 pool 一致）
//
// 來源：src/data/practice_pool.json `_meta.totals`（2026-04-25 版）
// 若 practice_pool.json 內容變動需同步更新此處（dev 啟動的 schema validator
// assert 內容形狀，但不 cross-check 此常數 — 所以人工同步）
export const PRACTICE_POOL_COUNTS = {
  externalMock: 55,
  aiGenerated: 96,
  total: 151,
} as const;
