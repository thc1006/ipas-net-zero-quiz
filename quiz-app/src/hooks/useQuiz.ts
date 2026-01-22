// 測驗邏輯 Hook
import { useState, useCallback, useMemo } from 'react';
import type {
  QuizQuestion,
  QuizConfig,
  AnswerRecord,
  QuizResult,
} from '../types/quiz';
import { getRandomQuestions, getQuestionsBySubject } from '../data/questions';

/** 測驗狀態 */
export interface QuizState {
  isActive: boolean;
  questions: QuizQuestion[];
  currentIndex: number;
  answers: AnswerRecord[];
  startTime: number | null;
  config: QuizConfig | null;
}

const initialState: QuizState = {
  isActive: false,
  questions: [],
  currentIndex: 0,
  answers: [],
  startTime: null,
  config: null,
};

/** 預設測驗配置 */
export const defaultConfig: QuizConfig = {
  mode: 'practice',
  subject: 'all',
  questionCount: 20,
  shuffleQuestions: true,
  shuffleOptions: false,
  showAnswerImmediately: true,
};

/**
 * 測驗邏輯 Hook
 */
export function useQuiz() {
  const [state, setState] = useState<QuizState>(initialState);
  const [questionStartTime, setQuestionStartTime] = useState<number>(0);

  /** 開始測驗 */
  const startQuiz = useCallback((config: QuizConfig) => {
    let questions: QuizQuestion[];

    if (config.shuffleQuestions) {
      // 隨機抽題
      questions = getRandomQuestions(
        config.questionCount,
        config.subject,
        config.mode === 'exam' // 考試模式只選有答案的題目
      );
    } else {
      // 順序取題
      const pool = getQuestionsBySubject(config.subject);
      questions = pool.slice(0, config.questionCount);
    }

    // 如果需要打亂選項順序
    if (config.shuffleOptions) {
      questions = questions.map((q) => ({
        ...q,
        options: shuffleArray([...q.options]),
      }));
    }

    setState({
      isActive: true,
      questions,
      currentIndex: 0,
      answers: [],
      startTime: Date.now(),
      config,
    });
    setQuestionStartTime(Date.now());
  }, []);

  /** 回答題目 */
  const submitAnswer = useCallback(
    (selectedAnswer: string | null) => {
      const { questions, currentIndex, config } = state;
      const question = questions[currentIndex];
      if (!question) return;

      const timeSpent = Date.now() - questionStartTime;
      const isCorrect =
        question.answer !== null ? selectedAnswer === question.answer : null;

      const record: AnswerRecord = {
        questionId: question.id,
        selectedAnswer,
        correctAnswer: question.answer,
        isCorrect,
        timeSpent,
        timestamp: Date.now(),
      };

      setState((prev) => ({
        ...prev,
        answers: [...prev.answers, record],
      }));

      // 練習模式下立即顯示答案
      if (config?.showAnswerImmediately) {
        return record;
      }

      return record;
    },
    [state, questionStartTime]
  );

  /** 下一題 */
  const nextQuestion = useCallback(() => {
    setState((prev) => {
      if (prev.currentIndex >= prev.questions.length - 1) {
        return prev;
      }
      return {
        ...prev,
        currentIndex: prev.currentIndex + 1,
      };
    });
    setQuestionStartTime(Date.now());
  }, []);

  /** 上一題 */
  const prevQuestion = useCallback(() => {
    setState((prev) => {
      if (prev.currentIndex <= 0) {
        return prev;
      }
      return {
        ...prev,
        currentIndex: prev.currentIndex - 1,
      };
    });
    setQuestionStartTime(Date.now());
  }, []);

  /** 跳到指定題目 */
  const goToQuestion = useCallback((index: number) => {
    setState((prev) => {
      if (index < 0 || index >= prev.questions.length) {
        return prev;
      }
      return {
        ...prev,
        currentIndex: index,
      };
    });
    setQuestionStartTime(Date.now());
  }, []);

  /** 結束測驗並取得結果 */
  const finishQuiz = useCallback((): QuizResult | null => {
    const { questions, answers, startTime, config } = state;
    if (!config || !startTime) return null;

    const endTime = Date.now();

    // 計算分數（只計算有答案的題目）
    const answeredWithCorrectAnswer = answers.filter(
      (a) => a.correctAnswer !== null
    );
    const correctCount = answeredWithCorrectAnswer.filter(
      (a) => a.isCorrect
    ).length;
    const wrongCount = answeredWithCorrectAnswer.filter(
      (a) => a.isCorrect === false
    ).length;
    const totalAnswerable = questions.filter((q) => q.hasAnswer).length;

    const result: QuizResult = {
      config,
      startTime,
      endTime,
      totalTime: endTime - startTime,
      answers,
      score:
        totalAnswerable > 0
          ? Math.round((correctCount / totalAnswerable) * 100)
          : 0,
      totalAnswerable,
      correctCount,
      wrongCount,
      skippedCount: questions.length - answers.length,
    };

    setState(initialState);

    return result;
  }, [state]);

  /** 重置測驗 */
  const resetQuiz = useCallback(() => {
    setState(initialState);
  }, []);

  // 衍生狀態
  const currentQuestion = useMemo(
    () => state.questions[state.currentIndex] ?? null,
    [state.questions, state.currentIndex]
  );

  const progress = useMemo(
    () => ({
      current: state.currentIndex + 1,
      total: state.questions.length,
      answered: state.answers.length,
      percentage:
        state.questions.length > 0
          ? Math.round(
              ((state.currentIndex + 1) / state.questions.length) * 100
            )
          : 0,
    }),
    [state.currentIndex, state.questions.length, state.answers.length]
  );

  const currentAnswer = useMemo(
    () =>
      state.answers.find(
        (a) => a.questionId === state.questions[state.currentIndex]?.id
      ) ?? null,
    [state.answers, state.questions, state.currentIndex]
  );

  const isLastQuestion = state.currentIndex >= state.questions.length - 1;
  const isFirstQuestion = state.currentIndex === 0;

  return {
    // 狀態
    isActive: state.isActive,
    questions: state.questions,
    currentQuestion,
    currentIndex: state.currentIndex,
    currentAnswer,
    progress,
    config: state.config,

    // 判斷
    isLastQuestion,
    isFirstQuestion,

    // 操作
    startQuiz,
    submitAnswer,
    nextQuestion,
    prevQuestion,
    goToQuestion,
    finishQuiz,
    resetQuiz,
  };
}

// 工具函數：打亂陣列
function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export default useQuiz;
