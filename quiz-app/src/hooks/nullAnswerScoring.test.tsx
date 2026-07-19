// 「無標準答案的題目絕不送到使用者面前」—— 這條保證原本沒有任何測試釘住，
// 後來釘住了「排除計分」，現在再收緊成「連出現都不出現」。
//
// 背景：有些題目來源互相矛盾或有多個正解，無法唯一作答（例：PAS 2060 到底哪一天
// 被撤回 ——「停售驗證 2024-01-01」「改用 ISO 14068-1 2025-01-01」「文件撤回 2025-11-30」
// 是三個不同事件，常被混為一談；又如「何者不是歐盟碳邊境管制」CCTS 與 CORSIA 都對）。
// 這種題我們刻意設成 answer=null + ambiguous、排除計分，而不是硬挑一個答案教錯的東西。
//
// 使用者回報「這題怎麼沒有答案」（#93/#94/#95）後決定：**這種題連在練習模式都不該出現**
// —— 使用者看到「選了卻沒有正解可對」只會困惑。因此改由抽題層一律過濾：
//   ① startQuiz / startQuizWithPool 不論 practice/exam，都用 hasAnswer 濾掉無答案題。
// 另留兩道防線當 defense-in-depth（萬一無答案題透過「續作舊進度」等路徑溜進作答中，
// 例如本次修正前存下的 localStorage 進度）：
//   ② submitAnswer 在 answer===null 時把 isCorrect 設成 null（而非 false）
//   ③ finishQuiz 的分母 totalAnswerable 只算 hasAnswer 的題目
// 只要任一退化，使用者就會拿到「永遠答錯」或「分母被稀釋」的分數 —— 這支測試把
// 「不出現」與那兩道防線一起釘住。
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
import type { QuizConfig, QuizResult } from '../types/quiz';

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

  // Defense-in-depth：抽題層已擋掉無答案題，但「續作舊進度」可能還原一份在本次
  // 修正前存下、含無答案題的 quiz。這種漏網情況下，計分仍必須把它當「未知」而非
  // 「答錯」，也不得稀釋分母。這裡用 saveProgress + resumeQuiz 重現那條路徑。
  it('萬一無答案題透過「續作舊進度」溜進作答中：submitAnswer 判 null、finishQuiz 不計分不稀釋', () => {
    const poolItems = buildFixturePool().items;
    const nullQ = toQuizQuestion(
      poolItems.find((i) => i.id === NULL_ANSWER_ID)!
    );
    const answerableQ = toQuizQuestion(
      poolItems.find((i) => i.id !== NULL_ANSWER_ID && i.answer != null)!
    );
    expect(nullQ.hasAnswer).toBe(false);
    expect(answerableQ.hasAnswer).toBe(true);

    // 模擬本次修正前存下的進度（含一題無答案 + 一題有答案）
    const staleState: QuizState = {
      isActive: true,
      questions: [answerableQ, nullQ],
      currentIndex: 0,
      answers: [],
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
      const ok = result.current.resumeQuiz();
      expect(ok).toBe(true);
    });
    // 前提：那題無答案題確實被還原進來了，否則後面的斷言都是空轉
    expect(result.current.questions.map((q) => q.id)).toContain(NULL_ANSWER_ID);

    // goToQuestion 與 submitAnswer 必須分開 act()：submitAnswer 從 state 閉包讀
    // currentIndex，同一個 act() 裡 goToQuestion 的更新還沒 commit，會作答到別題去。
    // 先正確作答「有答案」那題，讓分子不是 0（否則分數恆為 0，測不出稀釋）
    act(() => {
      result.current.goToQuestion(0);
    });
    act(() => {
      result.current.submitAnswer(answerableQ.answer);
    });

    // 再作答那題無答案的
    act(() => {
      result.current.goToQuestion(1);
    });
    let rec: ReturnType<typeof result.current.submitAnswer> | undefined;
    act(() => {
      rec = result.current.submitAnswer('A');
    });

    // 關鍵：isCorrect 必須是 null（不知道），不能是 false（答錯）。
    expect(rec?.isCorrect).toBeNull();
    expect(rec?.correctAnswer).toBeNull();

    let res: QuizResult | null = null;
    act(() => {
      res = result.current.finishQuiz();
    });

    expect(res).not.toBeNull();
    const r = res as unknown as QuizResult;

    // 分母只算有答案的題目：兩題裡只有 answerableQ 進分母。
    expect(r.totalAnswerable).toBe(1);
    // 答對 1、又「答了」1 題無答案題 → correct=1、wrong=0（無答案題兩邊都不算）。
    expect(r.correctCount).toBe(1);
    expect(r.wrongCount).toBe(0);

    const nullRec = r.answers.find((a) => a.questionId === NULL_ANSWER_ID);
    expect(nullRec).toBeDefined();
    expect(nullRec?.isCorrect).toBeNull();
  });
});
