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
import { dedupeByContent as sharedDedupe } from '../utils/question-identity';

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
 * 蒐集一題所有可顯示的來源 URL。
 *
 * 兩個欄位都要看：
 *   metadata.sources[]  —— 大部分題目用這個
 *   source.url          —— 由來源 PDF 重建的 230 題用這個（結構化的 source 物件）
 *
 * 先前 UI 只讀 metadata.sources，於是那 230 題**明明有指向來源 PDF 的連結，
 * 卻永遠不會顯示出來** —— 學生本來可以點進去看原始題目，卻看不到。
 * 「每題附來源」這個賣點，有一半是因為 UI 沒讀而落空的。
 *
 * 注意 gist 題目的 source 是字串 'gist'（不是物件），要濾掉。
 */
function collectSources(q: {
  metadata?: { sources?: string[] };
  source?: unknown;
}): string[] | undefined {
  const urls = [...(q.metadata?.sources ?? [])];
  const src = q.source;
  if (src && typeof src === 'object' && 'url' in src) {
    const u = (src as { url?: unknown }).url;
    if (typeof u === 'string' && /^https?:\/\//.test(u)) urls.push(u);
  }
  const uniq = [...new Set(urls.filter((u) => typeof u === 'string' && /^https?:\/\//.test(u)))];
  return uniq.length > 0 ? uniq : undefined;
}

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
    sources: collectSources(q),
    explanation: q.explanation,
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
    sources: collectSources(q),
    explanation: q.explanation ?? undefined,
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
 * 依「內容」去重（題幹 + 選項集合），而非依 id。
 *
 * 抽題是依 id 洗牌的，所以不會抽到同一個 item 兩次 —— 但同一道題目可能存在於
 * 兩個不同的 item。同科內的那種已經在資料層移除；剩下的是**跨科重複**
 * （考科一與考科二各有一份）：資料上必須兩份都留著，否則只考一科的考生會少一題，
 * 但在「全部」模式下兩份會被合在同一個池子裡，同一份考卷就會出現兩次。
 *
 * 所以在「抽題」這一層依內容去重，資料層不動。
 */
export function dedupeByContent(qs: QuizQuestion[]): QuizQuestion[] {
  // 指紋的定義搬到 utils/question-identity.ts，與 CI 的重複檢查**共用同一套**。
  //
  // 原本這裡是 `.replace(/\s+/g, '')` —— **只剝空白**，而 CI 的 gate 用的是
  // NFKC + 剝掉標點與分隔符。兩套定義不一致的後果：CI 擋得住的重複，
  // 使用者的考卷上照樣會出現兩次（實測有 5 組重複是被 U+2011/U+2013 連字號、
  // 「」vs “”、臺/台 遮住的）。gate 與執行期對「同一題」的定義必須是同一個。
  return sharedDedupe(qs);
}

/**
 * 取得隨機題目
 */
export function getRandomQuestions(
  count: number,
  subject: ExamSubject | 'all' = 'all',
  onlyWithAnswer = false
): QuizQuestion[] {
  let pool = dedupeByContent(getQuestionsBySubject(subject));
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
 * 從自訂題庫池中隨機抽題（用於混合主題庫 + 練習池等情境）
 */
export function getRandomQuestionsFromPool(
  pool: QuizQuestion[],
  count: number,
  subject: ExamSubject | 'all' = 'all',
  onlyWithAnswer = false
): QuizQuestion[] {
  let filtered = dedupeByContent(
    subject === 'all' ? pool : pool.filter((q) => q.subject === subject)
  );
  if (onlyWithAnswer) filtered = filtered.filter((q) => q.hasAnswer);
  const shuffled = [...filtered];
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
  // 排除無標準答案的題（answer=null，已排除計分）—— 相似題是給使用者對照作答用的，
  // 出一題「沒有正解可對」的相似題只會困惑（同 useQuiz 抽題層的處理，Refs #93/#94/#95）。
  const scored = allQuestions
    .filter((q) => q.id !== questionId && q.hasAnswer)
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
