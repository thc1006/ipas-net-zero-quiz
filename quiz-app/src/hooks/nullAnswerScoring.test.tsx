// 「無標準答案的題目絕不送到使用者面前」—— 這條保證原本沒有任何測試釘住，
// 後來釘住了「排除計分」，現在再收緊成「連出現都不出現」。
//
// 背景：有些題目來源互相矛盾或有多個正解，無法唯一作答（例：PAS 2060 到底哪一天
// 被撤回 ——「停售驗證 2024-01-01」「改用 ISO 14068-1 2025-01-01」「文件撤回 2025-11-30」
// 是三個不同事件，常被混為一談；又如「何者不是歐盟碳邊境管制」CCTS 與 CORSIA 都對）。
// 這種題我們刻意設成 answer=null + ambiguous、排除計分，而不是硬挑一個答案教錯的東西。
//
// 使用者回報「這題怎麼沒有答案」（#93/#94/#95）後決定：**這種題連在練習模式都不該出現**
// —— 使用者看到「選了卻沒有正解可對」只會困惑。因此三個「把題目送進作答」的入口一律過濾：
//   ① startQuiz / startQuizWithPool（隨機與循序、混池與不混池）都用 hasAnswer 濾掉無答案題。
//   ② resumeQuiz 續作舊進度時也濾掉 —— 進度永不過期，修正前存下、含無答案題的舊 quiz
//      任何時間續作都不該再出無答案題。
// 另留兩道防線當 belt-and-suspenders（將來若有人開新路徑漏送無答案題，計分仍不出錯）：
//   ③ submitAnswer 在 answer===null 時把 isCorrect 設成 null（而非 false）
//   ④ finishQuiz 的分母 totalAnswerable 只算 hasAnswer 的題目
// 這支測試把 exam/practice「不出現」與 resumeQuiz「續作也濾掉」一起釘住。
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useQuiz, type QuizState } from './useQuiz';
import {
  __resetPracticePoolCacheForTesting,
  __setPracticePoolForTesting,
  toQuizQuestion,
} from '../utils/practice-pool';
import {
  buildFixturePool,
  FIXTURE_NULL_ANSWER_ID,
} from '../utils/__fixtures__/practice-pool-fixture';
import { loadProgress } from '../utils/quiz-progress-storage';
import type { QuizConfig } from '../types/quiz';

// test-setup 的 localStorage 是純 vi.fn() stub（不真的存），所以 saveProgress→
// resumeQuiz 無法 round-trip。要測「續作舊進度還原一份含無答案題的 quiz」這條
// defense-in-depth 路徑，直接 mock loadProgress 回傳我們捏的進度即可。
// saveProgress / clearProgress 維持真實（配 stub localStorage 為無害 no-op）。
vi.mock('../utils/quiz-progress-storage', async (importActual) => {
  const actual =
    await importActual<typeof import('../utils/quiz-progress-storage')>();
  return { ...actual, loadProgress: vi.fn(() => null) };
});

// fixture 裡 answer=null + ambiguous 的那一題（由 fixture 自己匯出，避免這裡寫死 id）
const NULL_ANSWER_ID = FIXTURE_NULL_ANSWER_ID;

const baseConfig: QuizConfig = {
  mode: 'practice',
  subject: 'all',
  questionCount: 2000, // 取滿，確保整個池子（含 fixture-6）都會被抽題邏輯掃到
  shuffleQuestions: false, // 循序 → 決定性
  showAnswerImmediately: true,
  includePracticePool: true,
};

describe('無標準答案的題目（answer=null + ambiguous）絕不送到使用者面前', () => {
  beforeEach(() => {
    __setPracticePoolForTesting(buildFixturePool());
    (loadProgress as Mock).mockReturnValue(null);
  });

  afterEach(() => {
    __resetPracticePoolCacheForTesting();
  });

  // 前提守衛：整組測試的鑑別力全押在「fixture 真的有一題 answer=null」。
  // 少了它，只要有人把那題從 fixture 拿掉，not.toContain 與 hasAnswer 迴圈
  // 就都變成空轉 —— 靜默變綠（實測過）。
  function assertFixtureHasNull() {
    const pool = buildFixturePool();
    expect(
      pool.items.some((i) => i.id === NULL_ANSWER_ID && i.answer === null),
      'fixture 裡沒有 answer=null 的題目 —— 這條測試在空轉'
    ).toBe(true);
  }

  it('exam mode：整題不得出現（連看到都不該看到）', async () => {
    assertFixtureHasNull();
    const { result } = renderHook(() => useQuiz());
    await act(async () => {
      await result.current.startQuizWithPool({ ...baseConfig, mode: 'exam' });
    });

    const ids = result.current.questions.map((q) => q.id);
    expect(ids).not.toContain(NULL_ANSWER_ID);
    // 更強的斷言：不得有任何無答案題
    for (const q of result.current.questions) {
      expect(q.hasAnswer).toBe(true);
    }
  });

  it('practice mode：一樣不得出現（使用者不該遇到「沒有答案」的題）', async () => {
    assertFixtureHasNull();
    const { result } = renderHook(() => useQuiz());
    await act(async () => {
      await result.current.startQuizWithPool(baseConfig);
    });

    const ids = result.current.questions.map((q) => q.id);
    // 這正是回報 #93/#94/#95 的核心：練習模式從前會出無答案題，現在不再出。
    expect(ids).not.toContain(NULL_ANSWER_ID);
    for (const q of result.current.questions) {
      expect(q.hasAnswer).toBe(true);
    }
  });

  // resumeQuiz：續作「本次修正前存下、含無答案題」的舊進度時，一併把無答案題濾掉，
  // 讓「使用者不遇到無答案題」的保證對舊進度也成立；並正確重新錨定 currentIndex、
  // 清掉指向已移除題的殘留作答紀錄。用 mock loadProgress 注入一份舊進度重現。
  it('續作含無答案題的舊進度：無答案題被濾掉、currentIndex 錨回原題、殘留紀錄清除', () => {
    const poolItems = buildFixturePool().items;
    const nullQ = toQuizQuestion(
      poolItems.find((i) => i.id === NULL_ANSWER_ID)!
    );
    const answerableQ = toQuizQuestion(
      poolItems.find((i) => i.id !== NULL_ANSWER_ID && i.answer != null)!
    );
    expect(nullQ.hasAnswer).toBe(false);
    expect(answerableQ.hasAnswer).toBe(true);

    // 舊進度：無答案題在前（index 0）、使用者當時停在有答案題（index 1），
    // 且曾「作答」過那題無答案題（殘留一筆 isCorrect=null 的紀錄）。
    const staleState: QuizState = {
      isActive: true,
      questions: [nullQ, answerableQ],
      currentIndex: 1,
      answers: [
        {
          questionId: nullQ.id,
          selectedAnswer: 'A',
          correctAnswer: null,
          isCorrect: null,
          timeSpent: 1000,
          timestamp: Date.now(),
          sourceCategory: 'main_bank',
        },
      ],
      startTime: Date.now(),
      config: baseConfig,
    };
    (loadProgress as Mock).mockReturnValue({
      version: 1,
      savedAt: Date.now(),
      state: staleState,
    });

    const { result } = renderHook(() => useQuiz());
    act(() => {
      expect(result.current.resumeQuiz()).toBe(true);
    });

    // 無答案題被濾掉，只剩有答案題
    const ids = result.current.questions.map((q) => q.id);
    expect(ids).not.toContain(NULL_ANSWER_ID);
    expect(ids).toEqual([answerableQ.id]);
    // currentIndex 從 1（原本停在有答案題）錨回到它在濾後的新位置（0）
    expect(result.current.currentQuestion?.id).toBe(answerableQ.id);
    // 指向已移除題的殘留作答紀錄被清掉（progress.answered 由 1 → 0），
    // 否則 finishQuiz 的 skippedCount = questions.length - answers.length 會算錯。
    expect(result.current.progress.answered).toBe(0);
  });
});
