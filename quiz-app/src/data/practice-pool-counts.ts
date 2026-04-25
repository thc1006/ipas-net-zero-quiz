// Practice pool 數量單一事實來源 — UI 揭露文案禁止漂移到不同數字。
// 來源：src/data/practice_pool.json `_meta.totals`（2026-04-25 版）。
// 若 practice_pool.json 內容變動需同步更新此處（dev 啟動時的 schema validator
// 會 assert 內容形狀，但不會 assert 跟此常數一致 — 所以人工同步）。
export const PRACTICE_POOL_COUNTS = {
  externalMock: 55,
  aiGenerated: 98,
  total: 153,
} as const;
