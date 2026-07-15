// 測驗邏輯 Hook
import { useState, useCallback, useMemo, useEffect } from 'react';
import type {
  QuizQuestion,
  QuizConfig,
  AnswerRecord,
  QuizResult,
} from '../types/quiz';
import {
  getRandomQuestions,
  getQuestionsBySubject,
  getRandomQuestionsFromPool,
  dedupeByContent,
  allQuestions,
} from '../data/questions';
import { loadPracticePool, toQuizQuestion } from '../utils/practice-pool';
import {
  saveProgress,
  loadProgress,
  clearProgress,
} from '../utils/quiz-progress-storage';
import {
  recordAttempts,
  type AttemptUpdate,
} from '../utils/question-stats-storage';

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
  showAnswerImmediately: true,
};

/**
 * 測驗邏輯 Hook
 */
export function useQuiz() {
  const [state, setState] = useState<QuizState>(initialState);
  const [questionStartTime, setQuestionStartTime] = useState<number>(0);

  // 持久化 in-progress 測驗（Refs #71）：
  // 每次 state 變動且 isActive=true 時寫入 localStorage；isActive=false 不動
  // （清除由 finishQuiz / resetQuiz 主動呼叫，避免初始 mount 誤清舊進度）
  useEffect(() => {
    if (state.isActive) saveProgress(state);
  }, [state]);

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
      // 順序取題（同樣依內容去重：跨科重複在 'all' 模式下會同時落進池子）
      const pool = dedupeByContent(getQuestionsBySubject(config.subject));
      questions = pool.slice(0, config.questionCount);
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

  /**
   * 開始測驗（async 版本）：當 config.includePracticePool 為 true 時，
   * 動態載入練習池並混入抽題範圍；否則行為等同 startQuiz。
   * 練習池僅在使用者於 settings 啟用後才應傳入 includePracticePool=true。
   */
  const startQuizWithPool = useCallback(async (config: QuizConfig) => {
    let questions: QuizQuestion[];

    if (config.includePracticePool) {
      const pool = await loadPracticePool();
      const poolItems = pool.items
        .map(toQuizQuestion)
        .filter((q) => {
          // 只在 'all' 或明確映射 subject 一致時納入；排除 unmapped_subject
          if (config.subject === 'all') return true;
          if (q.qualityFlags?.includes('unmapped_subject')) return false;
          return q.subject === config.subject;
        });
      const combined: QuizQuestion[] = dedupeByContent([...allQuestions, ...poolItems]);

      questions = config.shuffleQuestions
        ? getRandomQuestionsFromPool(
            combined,
            config.questionCount,
            config.subject,
            config.mode === 'exam'
          )
        : (() => {
            const subjectFiltered =
              config.subject === 'all'
                ? combined
                : combined.filter((q) => q.subject === config.subject);
            const answerFiltered =
              config.mode === 'exam'
                ? subjectFiltered.filter((q) => q.hasAnswer)
                : subjectFiltered;
            return answerFiltered.slice(0, config.questionCount);
          })();
    } else {
      // 不混練習池 — fallback 到 startQuiz 邏輯
      if (config.shuffleQuestions) {
        questions = getRandomQuestions(
          config.questionCount,
          config.subject,
          config.mode === 'exam'
        );
      } else {
        const subjectFiltered = dedupeByContent(getQuestionsBySubject(config.subject));
        const answerFiltered =
          config.mode === 'exam'
            ? subjectFiltered.filter((q) => q.hasAnswer)
            : subjectFiltered;
        questions = answerFiltered.slice(0, config.questionCount);
      }
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
      const { questions, currentIndex } = state;
      const question = questions[currentIndex];
      if (!question) return;

      const timeSpent = Date.now() - questionStartTime;
      const isCorrect =
        question.answer !== null ? selectedAnswer === question.answer : null;

      const sourceCategory: AnswerRecord['sourceCategory'] =
        question.sourceType === 'practice_pool'
          ? question.provenance?.source_type ?? 'main_bank'
          : 'main_bank';

      const record: AnswerRecord = {
        questionId: question.id,
        selectedAnswer,
        correctAnswer: question.answer,
        isCorrect,
        timeSpent,
        timestamp: Date.now(),
        sourceCategory,
      };

      // 同一題重新作答（使用者點「上一題」回到已作答題目改答案）時，
      // 用 questionId 去重 — 覆蓋舊紀錄而非追加。否則 finishQuiz 的
      // correctCount / wrongCount / skippedCount 都會把同一題算多次。
      setState((prev) => {
        const idx = prev.answers.findIndex((a) => a.questionId === record.questionId);
        const answers =
          idx >= 0
            ? prev.answers.map((a, i) => (i === idx ? record : a))
            : [...prev.answers, record];
        return { ...prev, answers };
      });

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

    // 累積每題作答統計（Refs #64）— 跳題（selectedAnswer=null）與
    // 無標準答案題（correctAnswer=null）都不算 attempt
    const statUpdates: AttemptUpdate[] = answers
      .filter((a) => a.correctAnswer !== null && a.selectedAnswer !== null)
      .map((a) => ({
        id: a.questionId,
        isCorrect: a.isCorrect === true,
        at: a.timestamp,
      }));
    recordAttempts(statUpdates);

    clearProgress();
    setState(initialState);

    return result;
  }, [state]);

  /** 重置測驗（亦會清除持久化進度）— 用於 user 主動「重來」/ result 後返家 */
  const resetQuiz = useCallback(() => {
    clearProgress();
    setState(initialState);
  }, []);

  /**
   * 軟重置 in-memory state 但**保留** localStorage 進度（Refs #71）。
   * 用於 abort flow：使用者點「結束並返回首頁」時，state 歸零但 localStorage
   * 保留供下次 resume。避免 quiz hook 在 abort 後仍殘留 isActive=true 狀態。
   */
  const softReset = useCallback(() => {
    setState(initialState);
  }, []);

  /**
   * 從 localStorage 還原中斷的測驗（Refs #71）。
   * 找到合法 saved progress 時 restore 並回 true；否則回 false。
   * 由 App.tsx 在使用者點「繼續測驗」時呼叫。
   */
  const resumeQuiz = useCallback((): boolean => {
    const saved = loadProgress();
    if (!saved || !saved.state.isActive) return false;
    setState(saved.state);
    setQuestionStartTime(Date.now());
    return true;
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
    startQuizWithPool,
    submitAnswer,
    nextQuestion,
    prevQuestion,
    goToQuestion,
    finishQuiz,
    resetQuiz,
    softReset,
    resumeQuiz,
  };
}

export default useQuiz;
