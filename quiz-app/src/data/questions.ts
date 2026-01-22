// 題庫資料模組
// 由 integrated_dataset.json 轉換而來
// 產生時間：2026-01-22

import type {
  QuizDataset,
  QuizQuestion,
  GistQuestion,
  UniqueQuestion,
  ExamSubject,
} from '../types/quiz';

// 載入原始資料（build 時會被 Vite 處理）
import rawData from './integrated_dataset.json';

/** 原始題庫資料 */
export const dataset: QuizDataset = rawData as QuizDataset;

/** 題庫統計 */
export const stats = {
  total: dataset.meta.total_questions,
  subject1: dataset.meta.by_subject['考科1'],
  subject2: dataset.meta.by_subject['考科2'],
  withAnswer: dataset.meta.with_answer,
  gistCount: dataset.meta.gist_questions,
  uniqueCount: dataset.meta.our_unique_questions,
};

/**
 * 將 Gist 題目轉換為統一格式
 */
function convertGistQuestion(q: GistQuestion): QuizQuestion {
  return {
    id: `gist-${q.index}`,
    stem: q.stem,
    options: q.options,
    answer: q.answer,
    subject: q.exam_subject,
    sourceType: 'gist',
    year: null,
    hasAnswer: q.answer !== null,
  };
}

/**
 * 將補充題目轉換為統一格式
 */
function convertUniqueQuestion(q: UniqueQuestion): QuizQuestion {
  return {
    id: q.item_id,
    stem: q.stem,
    options: q.options,
    answer: q.answer,
    subject: q.exam_subject,
    sourceType: 'unique',
    year: q.year,
    hasAnswer: q.answer !== null,
  };
}

/** 所有題目（統一格式） */
export const allQuestions: QuizQuestion[] = [
  ...dataset.gist_items.map(convertGistQuestion),
  ...dataset.our_unique_items.map(convertUniqueQuestion),
];

/** 考科一題目 */
export const subject1Questions = allQuestions.filter(
  (q) => q.subject === '考科1'
);

/** 考科二題目 */
export const subject2Questions = allQuestions.filter(
  (q) => q.subject === '考科2'
);

/** 有答案的題目 */
export const questionsWithAnswer = allQuestions.filter((q) => q.hasAnswer);

/**
 * 依據考科取得題目
 */
export function getQuestionsBySubject(
  subject: ExamSubject | 'all'
): QuizQuestion[] {
  if (subject === 'all') return allQuestions;
  return allQuestions.filter((q) => q.subject === subject);
}

/**
 * 取得隨機題目
 */
export function getRandomQuestions(
  count: number,
  subject: ExamSubject | 'all' = 'all',
  onlyWithAnswer = false
): QuizQuestion[] {
  let pool = getQuestionsBySubject(subject);
  if (onlyWithAnswer) {
    pool = pool.filter((q) => q.hasAnswer);
  }

  // Fisher-Yates 洗牌演算法
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/**
 * 依據 ID 取得題目
 */
export function getQuestionById(id: string): QuizQuestion | undefined {
  return allQuestions.find((q) => q.id === id);
}

/**
 * 搜尋題目（題幹關鍵字）
 */
export function searchQuestions(keyword: string): QuizQuestion[] {
  const normalizedKeyword = keyword.toLowerCase().trim();
  if (!normalizedKeyword) return [];

  return allQuestions.filter((q) =>
    q.stem.toLowerCase().includes(normalizedKeyword)
  );
}

/**
 * 取得相似題目（簡單的關鍵字比對）
 */
export function getSimilarQuestions(
  questionId: string,
  maxResults = 5
): QuizQuestion[] {
  const question = getQuestionById(questionId);
  if (!question) return [];

  // 提取題幹中的關鍵字（簡單分詞）
  const keywords = question.stem
    .replace(/[？?。，、：；「」（）[\]【】]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  // 計算每題的相似度分數
  const scored = allQuestions
    .filter((q) => q.id !== questionId)
    .map((q) => {
      let score = 0;
      // 同考科加分
      if (q.subject === question.subject) score += 2;

      // 關鍵字匹配
      keywords.forEach((kw) => {
        if (q.stem.includes(kw)) score += 1;
      });

      return { question: q, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, maxResults).map((item) => item.question);
}
