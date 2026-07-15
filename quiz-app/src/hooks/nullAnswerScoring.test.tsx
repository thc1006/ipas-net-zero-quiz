// 「無標準答案的題目絕不可計分」—— 這條保證原本沒有任何測試釘住。
//
// 背景：有些題目的來源互相矛盾，無法唯一作答（例：PAS 2060 到底是哪一天被撤回 ——
// 「停售驗證 2024-01-01」「改用 ISO 14068-1 2025-01-01」「文件撤回 2025-11-30」
// 是三個不同事件，常被混為一談）。這種題目我們刻意設成 answer=null + ambiguous，
// 明確排除計分，而不是硬挑一個答案教錯的東西。
//
// 但「排除計分」這件事在程式裡是靠三個彼此獨立的地方共同達成的：
//   1. exam mode 用 hasAnswer 過濾，整題不出現
//   2. submitAnswer 在 answer===null 時把 isCorrect 設成 null（而非 false）
//   3. finishQuiz 的分母 totalAnswerable 只算 hasAnswer 的題目
// 只要其中任何一個退化，使用者就會拿到「永遠答錯」或「分母被稀釋」的分數 ——
// 而在此之前，沒有任何一個測試會變紅。這支測試就是把這三點同時釘住。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useQuiz } from './useQuiz';
import {
  __resetPracticePoolCacheForTesting,
  __setPracticePoolForTesting,
} from '../utils/practice-pool';
import {
  buildFixturePool,
  FIXTURE_NULL_ANSWER_ID,
} from '../utils/__fixtures__/practice-pool-fixture';
import type { QuizConfig, QuizResult } from '../types/quiz';

// fixture 裡 answer=null + ambiguous 的那一題（由 fixture 自己匯出，避免這裡寫死 id）
const NULL_ANSWER_ID = FIXTURE_NULL_ANSWER_ID;

const baseConfig: QuizConfig = {
  mode: 'practice',
  subject: 'all',
  questionCount: 2000, // 取滿，確保整個池子（含 fixture-6）都被納入
  shuffleQuestions: false, // 循序 → 決定性，抓得到 fixture-6

  showAnswerImmediately: true,
  includePracticePool: true,
};

describe('無標準答案的題目（answer=null + ambiguous）不得計分', () => {
  beforeEach(() => {
    __setPracticePoolForTesting(buildFixturePool());
  });

  afterEach(() => {
    __resetPracticePoolCacheForTesting();
  });

  it('exam mode：整題不得出現（連看到都不該看到）', async () => {
    // 前提：這條測試的鑑別力全部押在「fixture 裡真的有一題 answer=null」。
    // 沒有這個前提斷言，只要有人把那題從 fixture 拿掉，
    // `not.toContain` 與下面的 for 迴圈就都變成空轉 —— 靜默變綠（實測過）。
    // 主題庫目前 783 題全部都有答案，所以它是唯一的無答案題來源。
    const pool = buildFixturePool();
    expect(
      pool.items.some((i) => i.id === NULL_ANSWER_ID && i.answer === null),
      'fixture 裡沒有 answer=null 的題目 —— 這條測試在空轉'
    ).toBe(true);

    const { result } = renderHook(() => useQuiz());
    await act(async () => {
      await result.current.startQuizWithPool({ ...baseConfig, mode: 'exam' });
    });

    const ids = result.current.questions.map((q) => q.id);
    expect(ids).not.toContain(NULL_ANSWER_ID);
    // 更強的斷言：正式考模式下不得有任何無答案題
    for (const q of result.current.questions) {
      expect(q.hasAnswer).toBe(true);
    }
  });

  it('practice mode：可以出現（供研讀），但作答結果必須是 null 而非「答錯」', async () => {
    const { result } = renderHook(() => useQuiz());
    await act(async () => {
      await result.current.startQuizWithPool(baseConfig);
    });

    const idx = result.current.questions.findIndex((q) => q.id === NULL_ANSWER_ID);
    // 前提：這題確實被抽進來了，否則後面的斷言都是空轉（測試沒有鑑別力）
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(result.current.questions[idx].hasAnswer).toBe(false);

    // goToQuestion 與 submitAnswer 必須分開 act()（見下方 finishQuiz 測試的註解）
    act(() => {
      result.current.goToQuestion(idx);
    });

    let record: ReturnType<typeof result.current.submitAnswer> | undefined;
    act(() => {
      record = result.current.submitAnswer('A');
    });

    // 關鍵：isCorrect 必須是 null（不知道），不能是 false（答錯）。
    // 若退化成 false，使用者選什麼都會被判錯 —— 比不出這題還糟。
    expect(record?.isCorrect).toBeNull();
    expect(record?.correctAnswer).toBeNull();
  });

  it('finishQuiz：無答案題不得進入分子、分母、對錯數', async () => {
    const { result } = renderHook(() => useQuiz());
    await act(async () => {
      await result.current.startQuizWithPool(baseConfig);
    });

    const questions = result.current.questions;
    const idx = questions.findIndex((q) => q.id === NULL_ANSWER_ID);
    expect(idx).toBeGreaterThanOrEqual(0);

    // 注意：goToQuestion 與 submitAnswer 必須分開 act()。
    // submitAnswer 是從 state 閉包讀 currentIndex 的，同一個 act() 裡 goToQuestion 的
    // state 更新還沒 commit，submitAnswer 會拿到**舊的** currentIndex，作答到別題去。
    // （這正是本測試第一版失敗的原因 —— 是測試寫錯，不是程式錯。）
    const answerableIdx = questions.findIndex((q) => q.hasAnswer);
    expect(answerableIdx).toBeGreaterThanOrEqual(0);

    // 先正確作答一題「有答案」的題目，讓分子不是 0（否則分數恆為 0，測不出稀釋）
    act(() => {
      result.current.goToQuestion(answerableIdx);
    });
    act(() => {
      result.current.submitAnswer(questions[answerableIdx].answer);
    });

    // 再作答那題無答案的
    act(() => {
      result.current.goToQuestion(idx);
    });
    act(() => {
      result.current.submitAnswer('A');
    });

    // TS 看不到 act() 的 callback 有跑過，會把 res 收斂成 null，
    // 所以這裡明確標型別再轉一次（NonNullable<typeof res> 會塌成 never）。
    let res: QuizResult | null = null;
    act(() => {
      res = result.current.finishQuiz();
    });

    expect(res).not.toBeNull();
    const r = res as unknown as QuizResult;

    // 分母：只能算有答案的題目。若把無答案題也算進分母，分數會被無聲稀釋。
    expect(r.totalAnswerable).toBe(questions.filter((q) => q.hasAnswer).length);

    // 不可以寫成 `questions.length - 1`。
    // 那假設了「主題庫零題無答案」—— 一個**規則上允許為假**的前提
    // （question-integrity 明確允許 ambiguous + answer=null）。
    // 主題庫後來真的多了 4 題排除計分的題目，這條就假性變紅了。
    // 從資料實算，不要寫死。
    const noAnswer = questions.filter((q) => !q.hasAnswer).length;
    expect(noAnswer, '沒有任何無答案題 —— 這條測試在空轉').toBeGreaterThan(0);
    expect(r.totalAnswerable).toBe(questions.length - noAnswer);

    // 我們答對 1 題、又「答了」1 題無答案題。
    // 正確行為：correct=1、wrong=0 —— 那題無答案的兩邊都不算。
    expect(r.correctCount).toBe(1);
    expect(r.wrongCount).toBe(0);

    // 作答紀錄裡那題的 isCorrect 必須是 null
    const rec = r.answers.find((a) => a.questionId === NULL_ANSWER_ID);
    expect(rec).toBeDefined();
    expect(rec?.isCorrect).toBeNull();
  });
});
