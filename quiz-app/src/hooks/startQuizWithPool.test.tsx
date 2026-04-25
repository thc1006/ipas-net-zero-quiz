// startQuizWithPool 測試 — async 開始測驗、混入練習池
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useQuiz } from './useQuiz';
import { __resetPracticePoolCacheForTesting } from '../utils/practice-pool';

describe('useQuiz.startQuizWithPool', () => {
  beforeEach(() => __resetPracticePoolCacheForTesting());

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

  it('with includePracticePool can mix in pool items', async () => {
    const { result } = renderHook(() => useQuiz());
    await act(async () => {
      await result.current.startQuizWithPool({
        mode: 'practice',
        subject: 'all',
        questionCount: 30,
        shuffleQuestions: false, // ordered: mainBank first then pool
        shuffleOptions: false,
        showAnswerImmediately: true,
        includePracticePool: true,
      });
    });
    expect(result.current.questions).toHaveLength(30);
  });

  it('exam mode filters out questions without answer', async () => {
    const { result } = renderHook(() => useQuiz());
    await act(async () => {
      await result.current.startQuizWithPool({
        mode: 'exam',
        subject: 'all',
        questionCount: 10,
        shuffleQuestions: false,
        shuffleOptions: false,
        showAnswerImmediately: false,
        includePracticePool: true,
      });
    });
    for (const q of result.current.questions) {
      expect(q.hasAnswer).toBe(true);
    }
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
