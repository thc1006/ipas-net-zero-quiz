// startQuizWithPool 測試 — async 開始測驗、混入練習池
//
// 之前的 it.skip 因為動態 import('../data/practice_pool.json') 在 jsdom 環境
// 有時序敏感性 → flaky CI。改用 __setPracticePoolForTesting 注入小型 fixture，
// 直接測 hook 整合層而不依賴實際 200KB JSON 動態載入。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useQuiz } from './useQuiz';
import {
  __resetPracticePoolCacheForTesting,
  __setPracticePoolForTesting,
} from '../utils/practice-pool';
import { buildFixturePool } from '../utils/__fixtures__/practice-pool-fixture';

describe('useQuiz.startQuizWithPool', () => {
  beforeEach(() => {
    __setPracticePoolForTesting(buildFixturePool());
  });

  afterEach(() => {
    __resetPracticePoolCacheForTesting();
  });

  it('without includePracticePool behaves like startQuiz (uses main bank)', async () => {
    const { result } = renderHook(() => useQuiz());
    await act(async () => {
      await result.current.startQuizWithPool({
        mode: 'practice',
        subject: 'all',
        questionCount: 5,
        shuffleQuestions: true,
        shuffleOptions: false,
        showAnswerImmediately: true,
        includePracticePool: false,
      });
    });
    expect(result.current.questions).toHaveLength(5);
    expect(result.current.isActive).toBe(true);
    // none of the picked questions should be from practice pool
    for (const q of result.current.questions) {
      expect(q.sourceType).not.toBe('practice_pool');
    }
  });

  it('with includePracticePool can mix in pool items (questionCount 對 + 機率高足以抽到 pool)', async () => {
    const { result } = renderHook(() => useQuiz());
    // 抽 600 題（接近主題庫總量 647 + fixture pool 6 = 653）→ 接近全抽，
    // 高機率包含 pool 題（隨機抽樣，機率 = 1 - C(647, 600)/C(653, 600) ≈ 100%）
    await act(async () => {
      await result.current.startQuizWithPool({
        mode: 'practice',
        subject: 'all',
        questionCount: 600,
        shuffleQuestions: true,
        shuffleOptions: false,
        showAnswerImmediately: true,
        includePracticePool: true,
      });
    });
    expect(result.current.questions).toHaveLength(600);
    expect(result.current.isActive).toBe(true);
    // 600 picks 從 653 抽 → 至少 (600+6-653) = ≥0；用 hasAnswer fixture 推估
    // fixture-1 / fixture-2 / fixture-3 / fixture-4 / fixture-5 都有答案
    // 600/653 ≈ 91.9% 機率每題被抽，期望 5-6 fixture 入選
    const poolCount = result.current.questions.filter(
      (q) => q.sourceType === 'practice_pool',
    ).length;
    expect(poolCount).toBeGreaterThan(0);
  });

  it('exam mode filters out questions without answer', async () => {
    const { result } = renderHook(() => useQuiz());
    await act(async () => {
      await result.current.startQuizWithPool({
        mode: 'exam',
        subject: 'all',
        questionCount: 30,
        shuffleQuestions: false,
        shuffleOptions: false,
        showAnswerImmediately: false,
        includePracticePool: true,
      });
    });
    for (const q of result.current.questions) {
      expect(q.hasAnswer).toBe(true);
    }
    // fixture 中 item-6 沒答案 → 不應出現在 picked questions
    expect(result.current.questions.find((q) => q.id === 'fixture-6')).toBeUndefined();
  });

  it('subject filter excludes unmapped_subject pool items', async () => {
    const { result } = renderHook(() => useQuiz());
    await act(async () => {
      await result.current.startQuizWithPool({
        mode: 'practice',
        subject: '考科1',
        questionCount: 50,
        shuffleQuestions: true,
        shuffleOptions: false,
        showAnswerImmediately: true,
        includePracticePool: true,
      });
    });
    for (const q of result.current.questions) {
      // 全部都應該是考科1 + 不應帶 unmapped_subject 旗標
      if (q.sourceType === 'practice_pool') {
        expect(q.qualityFlags?.includes('unmapped_subject')).not.toBe(true);
      }
      expect(q.subject).toBe('考科1');
    }
  });
});
