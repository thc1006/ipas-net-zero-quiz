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
      // 隨機抽題 —— 無標準答案的題目一律不出（練習與考試皆同）。
      // 這類題答案是 null（來源互斥或多重正解，已排除計分），出到使用者面前
      // 只會看到「沒有正解可對」而困惑（Refs #93/#94/#95）。
      questions = getRandomQuestions(
        config.questionCount,
        config.subject,
        true
      );
    } else {
      // 順序取題（同樣依內容去重：跨科重複在 'all' 模式下會同時落進池子）
      // 同樣濾掉無答案題。
      const pool = dedupeByContent(getQuestionsBySubject(config.subject)).filter(
        (q) => q.hasAnswer
      );
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
            true // 無答案題一律不出（練習與考試皆同）
          )
        : (() => {
            const subjectFiltered =
              config.subject === 'all'
                ? combined
                : combined.filter((q) => q.subject === config.subject);
            const answerFiltered = subjectFiltered.filter((q) => q.hasAnswer);
            return answerFiltered.slice(0, config.questionCount);
          })();
    } else {
      // 不混練習池 — fallback 到 startQuiz 邏輯（同樣濾掉無答案題）
      if (config.shuffleQuestions) {
        questions = getRandomQuestions(
          config.questionCount,
          config.subject,
          true
        );
      } else {
        const subjectFiltered = dedupeByContent(
          getQuestionsBySubject(config.subject)
        ).filter((q) => q.hasAnswer);
        questions = subjectFiltered.slice(0, config.questionCount);
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

      // timeSpent 語意：自本題開始（questionStartTime）到「選擇答案」當下的時間。
      // 兩種模式現在都在選擇當下 submitAnswer（見 QuizPage：修正最後一題計分競態），
      // 因此這是「作答決定時間」而非「停留在該題的總時間」；重新作答會覆蓋為重選當下的值。
      // 目前無產品 UI 消費此欄位（ResultPage 顯示的是整份測驗的 totalTime），僅記錄／統計用途。
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
      questions,
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
   * 續作時把練習池題重新水合。
   *
   * 主題庫題在 localStorage 裡存的是 id，續作時本來就會用**現行題庫**重建；
   * 練習池題存的是整包物件，而那些物件是**存檔當下那版 adapter** 的產物 ——
   * 解析被丟掉、subject 被 fallback 成考科二。不補的話，這次修好的東西
   * 對「跨版本續作的那一場」永遠不成立，而使用者不會知道自己看的是舊資料。
   *
   * 只補顯示用欄位（解析／考科／來源／出處徽章），不動 answer / options / stem ——
   * 那三者一動就會與 answers 裡已記錄的 correctAnswer 分裂（見上方 #106 對帳說明）；
   * 顯示欄位沒有這個風險。池是 dynamic import，這裡不會把它拉進主 bundle。
   *
   * **已知限制**：qualityFlags 也不補。若某題在存檔後被標成爭議類旗標，這一場續作仍會
   * 沿用舊旗標而照常計分。理由是本函式在 setState 之後才非同步完成，此時 resumeQuiz 的
   * 可計分過濾與 currentIndex 重錨定都已經跑完；只換旗標而不重跑那兩步，會做出
   * 「畫面說不計分、finishQuiz 仍計分」的分裂狀態，比沿用舊旗標更糟。
   * 主題庫題不受影響（它們存的是 id，續作時本來就用現行題庫重建，旗標是新的）。
   * 真正要修得靠「續作時重跑一次過濾」，那會動到 resumeQuiz 的重錨定邏輯，另案處理。
   */
  const rehydratePoolQuestions = useCallback((questions: QuizQuestion[]): void => {
    if (!questions.some((q) => q.sourceType === 'practice_pool')) return;
    void loadPracticePool()
      .then((pool) => {
        const byId = new Map(pool.items.map((it) => [it.id, it]));
        setState((prev) => {
          if (!prev.isActive) return prev;
          let changed = false;
          const next = prev.questions.map((q) => {
            if (q.sourceType !== 'practice_pool') return q;
            const item = byId.get(q.id);
            if (!item) return q;
            const fresh = toQuizQuestion(item);
            if (q.explanation === fresh.explanation && q.subject === fresh.subject) {
              return q;
            }
            changed = true;
            return {
              ...q,
              explanation: fresh.explanation,
              subject: fresh.subject,
              sources: fresh.sources,
              provenance: fresh.provenance,
            };
          });
          return changed ? { ...prev, questions: next } : prev;
        });
      })
      .catch(() => {
        // 池載不進來只影響「解析顯示得比較舊」，續作本身照常 —— 不打斷使用者。
      });
  }, []);

  /**
   * 從 localStorage 還原中斷的測驗（Refs #71）。
   * 找到合法 saved progress 時 restore 並回 true；否則回 false。
   * 由 App.tsx 在使用者點「繼續測驗」時呼叫。
   */
  const resumeQuiz = useCallback((): boolean => {
    const saved = loadProgress();
    if (!saved || !saved.state.isActive) return false;
    const s = saved.state;

    // 本次修正前存下的進度可能含無答案題（answer=null，排除計分），而進度永不過期，
    // 之後任何時間續作都會遇到。續作時一併濾掉，讓「使用者不遇到無答案題」的保證
    // 對舊進度也成立（Refs #93/#94/#95）。
    const answerable = s.questions.filter((q) => q.hasAnswer);
    if (answerable.length === 0) {
      // 整份都是無答案題（極端）→ 沒有可續的題目，清掉舊進度、不續作。
      clearProgress();
      return false;
    }
    // #106 對帳：最小化持久化在 resume 時用**現行題庫**重建題目。若某題的標準答案在保存後
    // 被更正（如 gist[340] B→C），舊 answers 紀錄的 correctAnswer 會與重建後的現行
    // question.answer 不一致 —— 沿用會造成分裂：畫面回饋與 finishQuiz 依現行答案，該筆紀錄卻
    // 凍在舊答案。策略：丟棄該筆紀錄，讓該題以未作答呈現，使用者依現行內容重答（重答走
    // submitAnswer 會依現行答案重新計分）。只比得到「標準答案字母」—— 選項文字若在答案字母
    // 不變下被改寫，紀錄仍相容（顯示自動更新為現行），無法也無需從紀錄偵測（未存舊選項）。
    const answerById = new Map(answerable.map((q) => [q.id, q]));
    const reconciledAnswers = s.answers.filter((a) => {
      const q = answerById.get(a.questionId);
      return !!q && a.correctAnswer === q.answer;
    });

    const nothingDropped =
      answerable.length === s.questions.length &&
      reconciledAnswers.length === s.answers.length;

    if (nothingDropped) {
      setState(s); // 常態快路徑：題目與答案紀錄都無變動
    } else {
      // 有題被濾掉（無答案題）或有紀錄被對帳丟棄（答案已更正）→ 重新錨定：currentIndex
      // 指回原本正在作答的那一題（若它還在），否則往前收斂；answers 用對帳後的結果，
      // 避免 finishQuiz 的 skippedCount 與畫面回饋算錯。
      const curId = s.questions[s.currentIndex]?.id;
      const survivedIdx = answerable.findIndex((q) => q.id === curId);
      setState({
        ...s,
        questions: answerable,
        currentIndex:
          survivedIdx >= 0
            ? survivedIdx
            : Math.min(s.currentIndex, answerable.length - 1),
        answers: reconciledAnswers,
      });
    }
    rehydratePoolQuestions(answerable);
    setQuestionStartTime(Date.now());
    return true;
  }, [rehydratePoolQuestions]);

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
