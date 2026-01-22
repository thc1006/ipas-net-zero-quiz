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

      // 作答幾題
      act(() => {
        result.current.submitAnswer('A');
        result.current.nextQuestion();
        result.current.submitAnswer('B');
      });

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
});
