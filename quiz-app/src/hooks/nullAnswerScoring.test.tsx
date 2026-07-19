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

  it('practice mode（隨機抽題路徑）：一樣不得出現', async () => {
    // 上一條走循序（非 shuffle）分支；這條走 getRandomQuestionsFromPool 的隨機分支，
    // 確保兩條抽題路徑都有濾掉無答案題。
    assertFixtureHasNull();
    const { result } = renderHook(() => useQuiz());
    await act(async () => {
      await result.current.startQuizWithPool({
        ...baseConfig,
        shuffleQuestions: true,
      });
    });
    const ids = result.current.questions.map((q) => q.id);
    expect(ids).not.toContain(NULL_ANSWER_ID);
    for (const q of result.current.questions) {
      expect(q.hasAnswer).toBe(true);
    }
  });

  // resumeQuiz：續作「本次修正前存下、含無答案題」的舊進度時，一併把無答案題濾掉，
  // 讓「使用者不遇到無答案題」的保證對舊進度也成立。用 mock loadProgress 注入舊進度重現。
  // 直接構造 QuizQuestion（不經 pool），才能擺「多個 null + 多個存活題」，
  // 精確驗證 currentIndex 是「錨回原題」而非只是「往前 clamp」。
  describe('resumeQuiz：續作舊進度也濾掉無答案題', () => {
    const fixtureItems = buildFixturePool().items;
    const nullBase = toQuizQuestion(
      fixtureItems.find((i) => i.id === NULL_ANSWER_ID)!
    );
    const ansBase = toQuizQuestion(
      fixtureItems.find((i) => i.id !== NULL_ANSWER_ID && i.answer != null)!
    );
    const mkNull = (id: string) => ({ ...nullBase, id });
    const mkAns = (id: string) => ({ ...ansBase, id });

    function resume(state: QuizState) {
      (loadProgress as Mock).mockReturnValue({
        version: 1,
        savedAt: Date.now(),
        state,
      });
      const { result } = renderHook(() => useQuiz());
      let ok = false;
      act(() => {
        ok = result.current.resumeQuiz();
      });
      return { result, ok };
    }

    it('前提：base 題目一 null 一有答案（否則整組空轉）', () => {
      expect(nullBase.hasAnswer).toBe(false);
      expect(ansBase.hasAnswer).toBe(true);
    });

    it('無答案題被濾掉，且 currentIndex 精確錨回原本正在作答的那一題（非只往前 clamp）', () => {
      // [null, null, A, B]，使用者停在 A（index 2）。濾後只剩 [A, B]，A 在新位置 0。
      // 若程式退化成「往前 clamp」→ min(2, 1)=1 會錯指到 B —— 這個 fixture 抓得到差別。
      const { result, ok } = resume({
        isActive: true,
        questions: [mkNull('sn-0'), mkNull('sn-1'), mkAns('sa-A'), mkAns('sa-B')],
        currentIndex: 2,
        answers: [
          {
            questionId: 'sn-0',
            selectedAnswer: 'A',
            correctAnswer: null,
            isCorrect: null,
            timeSpent: 1,
            timestamp: Date.now(),
            sourceCategory: 'main_bank',
          },
        ],
        startTime: Date.now(),
        config: baseConfig,
      });
      expect(ok).toBe(true);
      // 兩題 null 都被濾掉
      expect(result.current.questions.map((q) => q.id)).toEqual(['sa-A', 'sa-B']);
      // 錨回 A（新 index 0），不是 clamp 到 B（新 index 1）
      expect(result.current.currentQuestion?.id).toBe('sa-A');
      // 指向已移除 null 的殘留作答紀錄被清掉（progress.answered 1 → 0）
      expect(result.current.progress.answered).toBe(0);
    });

    it('使用者當時正停在無答案題上 → 收斂到存活題（currentIndex 不越界）', () => {
      // [A, null, B]，使用者停在 null（index 1）。濾後 [A, B]，survivedIdx=-1 → min(1,1)=1 → B。
      const { result, ok } = resume({
        isActive: true,
        questions: [mkAns('sa-A'), mkNull('sn-0'), mkAns('sa-B')],
        currentIndex: 1,
        answers: [],
        startTime: Date.now(),
        config: baseConfig,
      });
      expect(ok).toBe(true);
      expect(result.current.questions.map((q) => q.id)).toEqual(['sa-A', 'sa-B']);
      expect(result.current.currentQuestion?.id).toBe('sa-B');
    });

    it('整份都是無答案題 → 不續作、清掉舊進度', () => {
      const { result, ok } = resume({
        isActive: true,
        questions: [mkNull('sn-0'), mkNull('sn-1')],
        currentIndex: 0,
        answers: [],
        startTime: Date.now(),
        config: baseConfig,
      });
      expect(ok).toBe(false);
      expect(result.current.isActive).toBe(false); // 沒 resume，維持 idle
    });
  });
});
