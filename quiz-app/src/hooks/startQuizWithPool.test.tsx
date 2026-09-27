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

  // 這條路徑（不含練習池 + 循序取題）原本沒有任何測試走到 —— Codecov 標出 useQuiz.ts
  // 有 1 行未覆蓋，正是這裡的 dedupeByContent。
  // 補測試不是為了衝覆蓋率：這條路徑同樣會把兩科合進一個池子（subject: 'all'），
  // 而少數題目考科一與考科二各有一份，不去重就會在同一份考卷出現兩次。
  it('without pool + 循序取題（不洗牌）也必須依內容去重', async () => {
    const { result } = renderHook(() => useQuiz());
    await act(async () => {
      await result.current.startQuizWithPool({
        mode: 'practice',
        subject: 'all',
        questionCount: 400, // 取夠多，才會涵蓋到跨科重複的題目
        shuffleQuestions: false, // ← 走 dedupeByContent 的循序分支

        showAnswerImmediately: true,
        includePracticePool: false,
      });
    });

    const qs = result.current.questions;
    expect(qs.length).toBeGreaterThan(0);
    for (const q of qs) {
      expect(q.sourceType).not.toBe('practice_pool');
    }

    // 同一份考卷不得出現內容相同的題目（即使 id 不同）
    const sig = (q: (typeof qs)[number]) =>
      q.stem.replace(/\s+/g, '') +
      '||' +
      q.options
        .map((o) => o.text.replace(/\s+/g, ''))
        .sort()
        .join('|');
    const sigs = qs.map(sig);
    expect(new Set(sigs).size).toBe(sigs.length);
  });

  // 這裡原本抽 600 題、再斷言「至少抽到一題練習池」：是機率，不是保證。主題庫從 647 題長到 879 題可計分之後，
  // 5 題有答案的 fixture 一題都沒抽到的機率約 (284/884)^5 ≈ 0.34%，突變測試跑 96 次就撞到一次。
  // 拆成兩條確定的斷言：抽幾題就給幾題；題數給到超過總量時全部抽出，練習池題一定都在。
  it('with includePracticePool gives exactly questionCount questions', async () => {
    const { result } = renderHook(() => useQuiz());
    await act(async () => {
      await result.current.startQuizWithPool({
        mode: 'practice',
        subject: 'all',
        questionCount: 600,
        shuffleQuestions: true,

        showAnswerImmediately: true,
        includePracticePool: true,
      });
    });
    expect(result.current.questions).toHaveLength(600);
    expect(result.current.isActive).toBe(true);
  });

  it('with includePracticePool mixes in every answerable pool item when drawing everything', async () => {
    const { result } = renderHook(() => useQuiz());
    await act(async () => {
      await result.current.startQuizWithPool({
        mode: 'practice',
        subject: 'all',
        questionCount: 100_000, // 超過主題庫 + 練習池的總題數：全部抽出，不靠運氣
        shuffleQuestions: true,

        showAnswerImmediately: true,
        includePracticePool: true,
      });
    });
    // fixture-1 到 fixture-5 有答案（fixture-6 沒有，無答案題一律不出）
    const pool = result.current.questions.filter((q) => q.sourceType === 'practice_pool');
    expect(pool.map((q) => q.id).sort()).toEqual([
      'fixture-1',
      'fixture-2',
      'fixture-3',
      'fixture-4',
      'fixture-5',
    ]);
  });

  it('exam mode filters out questions without answer', async () => {
    const { result } = renderHook(() => useQuiz());
    await act(async () => {
      await result.current.startQuizWithPool({
        mode: 'exam',
        subject: 'all',
        questionCount: 30,
        shuffleQuestions: false,

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
