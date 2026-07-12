// fixture 的防呆本身也要被測。
//
// buildFixturePool() 會檢查「那題刻意沒有答案的題目確實在池子裡」，因為
// nullAnswerScoring 那組測試的鑑別力**全部**押在它身上 —— 拿掉它，
// 「exam mode 不得出現無答案題」那條會靜默變綠（空轉），而測試看起來仍然全綠。
//
// 但那個防呆如果自己壞了，也不會有人知道 —— 那是**同一種錯，只是換了一層**。
// 一個從來沒被執行過的守衛，跟沒有守衛沒有兩樣。
import { describe, it, expect } from 'vitest';
import {
  buildFixturePool,
  assertFixtureHasNullAnswerItem,
  FIXTURE_NULL_ANSWER_ID,
} from './practice-pool-fixture';
import type { PracticePoolItem } from '../../types/practicePool';

describe('practice-pool fixture 的自我檢查', () => {
  it('正常的 fixture 必須通過檢查（不得誤報）', () => {
    const pool = buildFixturePool();
    expect(() => assertFixtureHasNullAnswerItem(pool.items)).not.toThrow();
  });

  it('fixture 確實含有那題 answer=null 的題目', () => {
    const pool = buildFixturePool();
    const target = pool.items.find((i) => i.id === FIXTURE_NULL_ANSWER_ID);
    expect(target).toBeDefined();
    expect(target!.answer).toBeNull();
    // answer=null 必須同時標 ambiguous，否則違反 question-integrity 的 missing_answer 規則
    expect(target!.quality_flags).toContain('ambiguous');
  });

  it('把那題拿掉 → 必須丟出例外（不能安靜地讓測試失去鑑別力）', () => {
    const pool = buildFixturePool();
    const without = pool.items.filter((i) => i.id !== FIXTURE_NULL_ANSWER_ID);
    expect(() => assertFixtureHasNullAnswerItem(without)).toThrow(/fixture 壞了/);
  });

  it('那題還在、但被補上了答案 → 一樣必須丟出例外', () => {
    // 這是更陰險的一種：id 還在，看起來 fixture 沒被動過，
    // 但它已經不是「無答案題」了，依賴它的測試照樣空轉。
    const pool = buildFixturePool();
    const patched: PracticePoolItem[] = pool.items.map((i) =>
      i.id === FIXTURE_NULL_ANSWER_ID ? { ...i, answer: 'A' } : i
    );
    expect(() => assertFixtureHasNullAnswerItem(patched)).toThrow(/fixture 壞了/);
  });

  it('空陣列 → 必須丟出例外', () => {
    expect(() => assertFixtureHasNullAnswerItem([])).toThrow(/fixture 壞了/);
  });
});
