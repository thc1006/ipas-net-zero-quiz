// 測驗邏輯 Hook 測試
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useQuiz, defaultConfig } from './useQuiz';
import type { QuizConfig } from '../types/quiz';

describe('useQuiz Hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  describe('初始狀態', () => {
    it('初始時測驗應為非進行中', () => {
      const { result } = renderHook(() => useQuiz());
      expect(result.current.isActive).toBe(false);
    });

    it('初始時應無目前題目', () => {
      const { result } = renderHook(() => useQuiz());
      expect(result.current.currentQuestion).toBeNull();
    });

    it('初始時進度應為 0', () => {
      const { result } = renderHook(() => useQuiz());
      expect(result.current.progress.current).toBe(1);
      expect(result.current.progress.total).toBe(0);
    });
  });

  describe('startQuiz', () => {
    it('開始測驗後狀態應為進行中', () => {
      const { result } = renderHook(() => useQuiz());

      act(() => {
        result.current.startQuiz(defaultConfig);
      });

      expect(result.current.isActive).toBe(true);
    });

    it('應載入指定數量的題目', () => {
      const { result } = renderHook(() => useQuiz());
      const config: QuizConfig = { ...defaultConfig, questionCount: 10 };

      act(() => {
        result.current.startQuiz(config);
      });

      expect(result.current.questions.length).toBe(10);
    });

    it('應有目前題目', () => {
      const { result } = renderHook(() => useQuiz());

      act(() => {
        result.current.startQuiz(defaultConfig);
      });

      expect(result.current.currentQuestion).not.toBeNull();
    });

    it('限定考科時應只載入該考科題目', () => {
      const { result } = renderHook(() => useQuiz());
      const config: QuizConfig = {
        ...defaultConfig,
        subject: '考科1',
        questionCount: 10,
      };

      act(() => {
        result.current.startQuiz(config);
      });

      result.current.questions.forEach((q) => {
        expect(q.subject).toBe('考科1');
      });
    });
  });

  describe('submitAnswer', () => {
    it('提交答案後應記錄到 answers', () => {
      const { result } = renderHook(() => useQuiz());

      act(() => {
        result.current.startQuiz({ ...defaultConfig, questionCount: 5 });
      });

      act(() => {
        result.current.submitAnswer('A');
      });

      expect(result.current.currentAnswer).not.toBeNull();
      expect(result.current.currentAnswer?.selectedAnswer).toBe('A');
    });

    it('答案紀錄應包含時間資訊', () => {
      const { result } = renderHook(() => useQuiz());

      act(() => {
        result.current.startQuiz({ ...defaultConfig, questionCount: 5 });
      });

      // 模擬經過 1 秒
      vi.advanceTimersByTime(1000);

      act(() => {
        result.current.submitAnswer('B');
      });

      expect(result.current.currentAnswer?.timeSpent).toBeGreaterThanOrEqual(
        1000
      );
    });

    // === Regression: GH issue #59 — 回到上一題重新作答時不可重複新增紀錄 ===
    it('重新作答同一題應覆蓋舊紀錄、不應追加（GH #59）', () => {
      const { result } = renderHook(() => useQuiz());
      act(() => {
        result.current.startQuiz({ ...defaultConfig, questionCount: 3, shuffleQuestions: false });
      });

      // 第 1 題答 A → 下一題答 B → 回上一題改答 C
      act(() => { result.current.submitAnswer('A'); });
      act(() => { result.current.nextQuestion(); });
      act(() => { result.current.submitAnswer('B'); });
      act(() => { result.current.prevQuestion(); });
      act(() => { result.current.submitAnswer('C'); });

      // useQuiz 不直接公開 answers — 透過 progress.answered 與 finishQuiz() 驗證
      expect(result.current.progress.answered).toBe(2);

      let quizResult: ReturnType<typeof result.current.finishQuiz> = null;
      act(() => {
        quizResult = result.current.finishQuiz();
      });
      expect(quizResult!.answers).toHaveLength(2);

      // 第 1 題保留最新的 C
      const q1Record = quizResult!.answers.find(
        (a) => a.selectedAnswer === 'C'
      );
      expect(q1Record).toBeDefined();
      // 「A」紀錄應已被 C 覆蓋、不存在於最終結果
      expect(quizResult!.answers.some((a) => a.selectedAnswer === 'A')).toBe(false);
    });

    it('currentAnswer 在重新作答後應反映最新選擇而非首次選擇（GH #59）', () => {
      const { result } = renderHook(() => useQuiz());
      act(() => {
        result.current.startQuiz({ ...defaultConfig, questionCount: 3, shuffleQuestions: false });
      });

      // 第 1 題答 A
      act(() => { result.current.submitAnswer('A'); });
      expect(result.current.currentAnswer?.selectedAnswer).toBe('A');

      // 移到 Q2 再回 Q1，改答 'C'
      act(() => { result.current.nextQuestion(); });
      act(() => { result.current.prevQuestion(); });
      act(() => { result.current.submitAnswer('C'); });

      // currentAnswer 應顯示 'C'（最新），而非 'A'（首次）。修法前 .find() 會回第一個 match → 'A'
      expect(result.current.currentAnswer?.selectedAnswer).toBe('C');
    });

    it('finishQuiz 在重新作答後計分不應重複計算（GH #59）', () => {
      const { result } = renderHook(() => useQuiz());
      act(() => {
        result.current.startQuiz({ ...defaultConfig, questionCount: 3, shuffleQuestions: false });
      });

      // 三題都先答錯（用一個不可能對的字串），再回去把第 1 題改成正解
      act(() => { result.current.submitAnswer('Z'); });
      act(() => { result.current.nextQuestion(); });
      act(() => { result.current.submitAnswer('Z'); });
      act(() => { result.current.nextQuestion(); });
      act(() => { result.current.submitAnswer('Z'); });

      // 回第 1 題，改答正解
      act(() => { result.current.goToQuestion(0); });
      const correctAnswer = result.current.currentQuestion?.answer;
      if (correctAnswer == null) return; // 該題無答案則略過此 assertion
      act(() => { result.current.submitAnswer(correctAnswer); });

      let quizResult: ReturnType<typeof result.current.finishQuiz> = null;
      act(() => {
        quizResult = result.current.finishQuiz();
      });

      // 重點：3 題測驗作答 4 次（其中 1 題被覆蓋），最終 answers 應為 3 筆
      expect(quizResult!.answers).toHaveLength(3);
      // skippedCount 不應為負（修法前的 questions.length - answers.length 會算成負數）
      expect(quizResult!.skippedCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('nextQuestion / prevQuestion', () => {
    it('nextQuestion 應移動到下一題', () => {
      const { result } = renderHook(() => useQuiz());

      act(() => {
        result.current.startQuiz({ ...defaultConfig, questionCount: 5 });
      });

      const firstQuestionId = result.current.currentQuestion?.id;

      act(() => {
        result.current.nextQuestion();
      });

      expect(result.current.currentIndex).toBe(1);
      expect(result.current.currentQuestion?.id).not.toBe(firstQuestionId);
    });

    it('最後一題時 nextQuestion 不應移動', () => {
      const { result } = renderHook(() => useQuiz());

      act(() => {
        result.current.startQuiz({ ...defaultConfig, questionCount: 2 });
      });

      act(() => {
        result.current.nextQuestion();
      });

      expect(result.current.currentIndex).toBe(1);
      expect(result.current.isLastQuestion).toBe(true);

      act(() => {
        result.current.nextQuestion();
      });

      expect(result.current.currentIndex).toBe(1);
    });

    it('prevQuestion 應移動到上一題', () => {
      const { result } = renderHook(() => useQuiz());

      act(() => {
        result.current.startQuiz({ ...defaultConfig, questionCount: 5 });
      });

      act(() => {
        result.current.nextQuestion();
        result.current.nextQuestion();
      });

      expect(result.current.currentIndex).toBe(2);

      act(() => {
        result.current.prevQuestion();
      });

      expect(result.current.currentIndex).toBe(1);
    });

    it('第一題時 prevQuestion 不應移動', () => {
      const { result } = renderHook(() => useQuiz());

      act(() => {
        result.current.startQuiz({ ...defaultConfig, questionCount: 5 });
      });

      expect(result.current.isFirstQuestion).toBe(true);

      act(() => {
        result.current.prevQuestion();
      });

      expect(result.current.currentIndex).toBe(0);
    });
  });

  describe('goToQuestion', () => {
    it('應能跳到指定題目', () => {
      const { result } = renderHook(() => useQuiz());

      act(() => {
        result.current.startQuiz({ ...defaultConfig, questionCount: 10 });
      });

      act(() => {
        result.current.goToQuestion(5);
      });

      expect(result.current.currentIndex).toBe(5);
    });

    it('無效索引時不應移動', () => {
      const { result } = renderHook(() => useQuiz());

      act(() => {
        result.current.startQuiz({ ...defaultConfig, questionCount: 5 });
      });

      act(() => {
        result.current.goToQuestion(100);
      });

      expect(result.current.currentIndex).toBe(0);

      act(() => {
        result.current.goToQuestion(-1);
      });

      expect(result.current.currentIndex).toBe(0);
    });
  });

  describe('finishQuiz', () => {
    it('應回傳測驗結果', () => {
      const { result } = renderHook(() => useQuiz());

      act(() => {
        result.current.startQuiz({ ...defaultConfig, questionCount: 3 });
      });

      // 注意：必須拆成獨立 act() — 同一個 act 內的多次呼叫會共享 stale closure，
      // 兩次 submitAnswer 都會打到 questions[0]（currentIndex 還沒 flush）。
      act(() => { result.current.submitAnswer('A'); });
      act(() => { result.current.nextQuestion(); });
      act(() => { result.current.submitAnswer('B'); });

      let quizResult: ReturnType<typeof result.current.finishQuiz> = null;
      act(() => {
        quizResult = result.current.finishQuiz();
      });

      expect(quizResult).not.toBeNull();
      expect(quizResult!.answers.length).toBe(2);
      expect(quizResult!.config).toBeDefined();
    });

    it('結束後測驗狀態應重置', () => {
      const { result } = renderHook(() => useQuiz());

      act(() => {
        result.current.startQuiz({ ...defaultConfig, questionCount: 3 });
      });

      act(() => {
        result.current.finishQuiz();
      });

      expect(result.current.isActive).toBe(false);
      expect(result.current.questions.length).toBe(0);
    });
  });

  describe('resetQuiz', () => {
    it('應重置所有狀態', () => {
      const { result } = renderHook(() => useQuiz());

      act(() => {
        result.current.startQuiz({ ...defaultConfig, questionCount: 5 });
        result.current.submitAnswer('A');
        result.current.nextQuestion();
      });

      act(() => {
        result.current.resetQuiz();
      });

      expect(result.current.isActive).toBe(false);
      expect(result.current.questions.length).toBe(0);
      expect(result.current.currentIndex).toBe(0);
    });
  });

  describe('progress', () => {
    it('進度應正確計算', () => {
      const { result } = renderHook(() => useQuiz());

      act(() => {
        result.current.startQuiz({ ...defaultConfig, questionCount: 10 });
      });

      expect(result.current.progress.current).toBe(1);
      expect(result.current.progress.total).toBe(10);
      expect(result.current.progress.percentage).toBe(10);

      act(() => {
        result.current.nextQuestion();
      });

      expect(result.current.progress.current).toBe(2);
      expect(result.current.progress.percentage).toBe(20);
    });
  });

  // === resumeQuiz（Refs #71）===
  // 此區需要真實 localStorage 行為（test-setup mock 會讓 getItem 回 undefined）
  describe('resumeQuiz', () => {
    const STORAGE_KEY = 'ipas-quiz-in-progress';

    beforeEach(() => {
      // 同 quiz-progress-storage.test.ts 的 real localStorage 安裝
      const store = new Map<string, string>();
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: (k: string): string | null => store.get(k) ?? null,
          setItem: (k: string, v: string): void => {
            store.set(k, v);
          },
          removeItem: (k: string): void => {
            store.delete(k);
          },
          clear: (): void => {
            store.clear();
          },
          key: (i: number): string | null => Array.from(store.keys())[i] ?? null,
          get length(): number {
            return store.size;
          },
        },
        writable: true,
        configurable: true,
      });
    });

    it('localStorage 無進度時 resumeQuiz 回 false、不改 state', () => {
      const { result } = renderHook(() => useQuiz());
      let returned = true;
      act(() => {
        returned = result.current.resumeQuiz();
      });
      expect(returned).toBe(false);
      expect(result.current.isActive).toBe(false);
    });

    it('localStorage 有合法進度時 resumeQuiz 還原 state、回 true', () => {
      // 先以 startQuiz 建立 state（會自動寫入 localStorage via useEffect）
      const { result, unmount } = renderHook(() => useQuiz());
      act(() => {
        result.current.startQuiz({ ...defaultConfig, questionCount: 5 });
      });
      act(() => {
        result.current.submitAnswer('A');
      });
      act(() => {
        result.current.nextQuestion();
      });
      const expectedIndex = result.current.currentIndex;
      const expectedQuestionCount = result.current.questions.length;

      // unmount 模擬 reload；新 hook 進來後 localStorage 仍有資料
      unmount();
      const fresh = renderHook(() => useQuiz());
      expect(fresh.result.current.isActive).toBe(false); // 初始未 active

      let returned = false;
      act(() => {
        returned = fresh.result.current.resumeQuiz();
      });
      expect(returned).toBe(true);
      expect(fresh.result.current.isActive).toBe(true);
      expect(fresh.result.current.currentIndex).toBe(expectedIndex);
      expect(fresh.result.current.questions.length).toBe(expectedQuestionCount);
    });

    it('localStorage 有壞掉資料時 resumeQuiz 回 false', () => {
      window.localStorage.setItem(STORAGE_KEY, 'not-json');
      const { result } = renderHook(() => useQuiz());
      let returned = true;
      act(() => {
        returned = result.current.resumeQuiz();
      });
      expect(returned).toBe(false);
      expect(result.current.isActive).toBe(false);
    });

    it('finishQuiz 後 localStorage 被清，後續 resumeQuiz 回 false', () => {
      const { result } = renderHook(() => useQuiz());
      act(() => {
        result.current.startQuiz({ ...defaultConfig, questionCount: 3 });
      });
      act(() => {
        result.current.submitAnswer('A');
      });
      act(() => {
        result.current.finishQuiz();
      });
      // localStorage 已被 clearProgress 清掉
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

      let returned = true;
      act(() => {
        returned = result.current.resumeQuiz();
      });
      expect(returned).toBe(false);
    });

    it('resetQuiz 後 localStorage 被清，後續 resumeQuiz 回 false', () => {
      const { result } = renderHook(() => useQuiz());
      act(() => {
        result.current.startQuiz({ ...defaultConfig, questionCount: 3 });
      });
      act(() => {
        result.current.resetQuiz();
      });
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

      let returned = true;
      act(() => {
        returned = result.current.resumeQuiz();
      });
      expect(returned).toBe(false);
    });

    // softReset：abort flow 用 — in-memory state 歸零但保留 localStorage
    it('softReset 重置 state 但**保留** localStorage 進度（abort flow）', () => {
      const { result } = renderHook(() => useQuiz());
      act(() => {
        result.current.startQuiz({ ...defaultConfig, questionCount: 3 });
      });
      act(() => {
        result.current.submitAnswer('A');
      });
      // 確認 localStorage 已寫入
      expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();

      act(() => {
        result.current.softReset();
      });

      // in-memory state 歸零
      expect(result.current.isActive).toBe(false);
      expect(result.current.questions.length).toBe(0);
      // localStorage **保留**（vs resetQuiz 會清）
      expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();

      // softReset 後仍可 resume（localStorage 還在）
      let returned = false;
      act(() => {
        returned = result.current.resumeQuiz();
      });
      expect(returned).toBe(true);
      expect(result.current.isActive).toBe(true);
    });
  });
});
