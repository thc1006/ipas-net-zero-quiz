// 題目來源（#128「只出官方題目」）：一題算不算某個來源、來源在畫面上的名稱、原卷的順序、抽題範圍。
//
// 判斷依據只有資料上的官方標記：officialExam（由 tools/import_official_exam.py 從官方公告試題的 PDF 匯入時寫入）
// 與 officialSample（由 tools/import_official_sample.py 從參考樣題的 PDF 匯入時寫入）。不看題號、不看題目文字：
// 同一題拿掉標記就不算官方題。認不得的來源一題都不收（fail-closed），不會悄悄退回「全部題目」，否則使用者以為
// 自己在練官方題，實際上混進了非官方的題目。一題最多帶一種標記（data/official-sample.test.ts 擋兩種都帶的題目）。
import type { ExamSubject, QuestionSource, QuizQuestion, ReviewSource } from '../types/quiz';
import { sampleEditionLabel, sessionLabel } from './official-exam';
import { dedupeByContent } from './question-identity';
import { isQuestionScorable } from './scorable';
import { REVIEW_REMOVE_STREAK, type ReviewSnapshot } from './review-storage';

/** 星號與待複習錯題的三個來源，也是它們在選單上的順序 */
export const REVIEW_SOURCES: readonly ReviewSource[] = ['review:starred', 'review:wrong', 'review:both'];

/** 用 unknown：存檔裡的來源要先過這一關（quiz-progress-storage.ts） */
export function isReviewSource(source: unknown): source is ReviewSource {
  return (REVIEW_SOURCES as readonly unknown[]).includes(source);
}

/**
 * 這一題算不算 source 這個來源。星號與待複習錯題不是題目的屬性，這裡一題都不收：
 * 抽題範圍走 reviewCandidates，存檔檢查走 isReviewSource
 */
export function matchesSource(q: QuizQuestion, source: QuestionSource): boolean {
  if (source === 'all') return true;
  const exam = q.officialExam;
  const sample = q.officialSample;
  if (source === 'official') return Boolean(exam || sample);
  // 場次與版次的格式不另外驗：比的是資料上的值，那裡的格式由 schema 守（main-bank.schema.json）
  if (source.startsWith('exam:'))
    return exam?.session === source.slice('exam:'.length);
  if (source.startsWith('sample:')) {
    return sample?.edition === source.slice('sample:'.length);
  }
  return false;
}

/** 題庫裡有哪幾場官方公告試題，新到舊排列（選單的順序） */
export function officialSessions(questions: readonly QuizQuestion[]): string[] {
  const sessions = new Set<string>();
  for (const q of questions) if (q.officialExam) sessions.add(q.officialExam.session);
  return [...sessions].sort().reverse();
}

/** 題庫裡有哪幾版參考樣題，新到舊排列（選單的順序） */
export function sampleEditions(questions: readonly QuizQuestion[]): string[] {
  const editions = new Set<string>();
  for (const q of questions) if (q.officialSample) editions.add(q.officialSample.edition);
  return [...editions].sort().reverse();
}

/**
 * 來源在選單上的名稱。選單在手機寬度、最大字級下也要完整顯示每一個選項（tests/e2e/official-mode.spec.ts
 * 逐一量），名稱要短：「全部官方題目」已經表明這些來源都是官方的，某一場、某一版就不再寫「官方」
 * （「115 年第一次公告試題」）。題卡上的標籤照舊寫「115 年第一次官方公告試題」（utils/official-exam.ts）
 */
export function questionSourceLabel(source: QuestionSource): string {
  if (source === 'all') return '全部題目';
  if (source === 'official') return '全部官方題目';
  if (source === 'review:starred') return '星號題';
  if (source === 'review:wrong') return '待複習錯題';
  if (source === 'review:both') return '星號 + 待複習錯題';
  if (source.startsWith('sample:')) return sampleEditionLabel(source.slice('sample:'.length));
  return `${sessionLabel(source.slice('exam:'.length))}公告試題`;
}

/**
 * 說明文字第一句在稱呼後面補上的範圍：「全部官方題目」包含公告試題與參考樣題。選單上的名稱要短，手機寬度
 * 才放得下（tests/e2e/official-mode.spec.ts 量每一個選項），範圍就寫在這裡；其他來源的名稱本身已經說清楚
 */
export function questionSourceScope(source: QuestionSource): string {
  return source === 'official' ? '（公告試題與參考樣題）' : '';
}

/** 提示文字裡怎麼稱呼這個來源的題目（「可出 50 題官方公告試題」） */
export function questionSourceNoun(source: QuestionSource): string {
  if (source === 'all') return '題目';
  if (source === 'official') return '官方題目';
  if (source === 'review:starred') return '星號題';
  if (source === 'review:wrong') return '待複習錯題';
  if (source === 'review:both') return '星號題與待複習錯題';
  if (source.startsWith('sample:')) return '參考樣題';
  return '官方公告試題';
}

/** 選單上帶題數的名稱：「星號題（12 題）」。count 是 null 代表練習池還在載入，題數還不知道 */
export function reviewOptionLabel(source: ReviewSource, count: number | null): string {
  return `${questionSourceLabel(source)}（${count === null ? '載入中' : `${count} 題`}）`;
}

/** 一題都沒有時的說明：題目要怎麼加進來；otherSubjectHasSome 是別的考科範圍有題目，要換的是考科 */
export function reviewEmptyHint(source: ReviewSource, otherSubjectHasSome: boolean): string {
  if (otherSubjectHasSome) {
    return `這個考科範圍沒有${questionSourceNoun(source)}，可以把考科範圍改成全部。`;
  }
  const starHow = '作答時按題目上的星號';
  const wrongHow = `測驗答錯的題目會自動列入，連續答對 ${REVIEW_REMOVE_STREAK} 次後移出`;
  if (source === 'review:starred') return `還沒有星號題。${starHow}，題目就會出現在這裡。`;
  if (source === 'review:wrong') return `還沒有待複習錯題。${wrongHow}。`;
  return `還沒有星號題或待複習錯題。${starHow}，或是${wrongHow}。`;
}

/**
 * 一題在官方卷裡的位置：哪一份卷、哪一科、第幾題。公告試題的卷是場次（115-01）；參考樣題記成那一年的
 * 第 00 次（114 年版是 114-00），排在同一年的公告試題之前（梯次從 01 起算）：114 年版的檔名寫「114年1月版」，
 * 早於當年的公告試題。場次、版次、科目都是定寬代號（schema 的 pattern），字串順序就是時間與科目順序。
 */
function paperKey(q: QuizQuestion) {
  const exam = q.officialExam;
  if (exam) return { paper: exam.session, subject: exam.subject, number: exam.question_number };
  const sample = q.officialSample;
  if (sample) {
    return {
      paper: `${sample.edition}-00`,
      subject: sample.subject,
      number: sample.question_number,
    };
  }
  return null;
}

/**
 * 原卷順序：卷（舊到新；同一年參考樣題在公告試題之前）、科目（第一科在前）、題號。沒有官方標記的題目
 * 排在最後、彼此相等（sort 是穩定的，所以維持原順序）。混著兩種題目時也必須是一致的比較函式：ECMA-262 規定
 * 比較函式不一致時，Array.prototype.sort 的結果由實作決定。
 */
export function byPaperOrder(a: QuizQuestion, b: QuizQuestion): number {
  const x = paperKey(a);
  const y = paperKey(b);
  if (!x || !y) return (x ? 0 : 1) - (y ? 0 : 1);
  if (x.paper !== y.paper) return x.paper < y.paper ? -1 : 1;
  if (x.subject !== y.subject) return x.subject < y.subject ? -1 : 1;
  return x.number - y.number;
}

/**
 * 只出官方題目時的抽題範圍：pool 裡帶對應官方標記、考科相符、有標準答案的題目，
 * 照原卷順序排列，依內容去重。
 *
 * 先拿掉沒有標準答案的題目，再排序、去重：同一題在兩份官方卷都出過時，留下最早一份有答案的那一題，
 * 與匯入的先後無關；最早那一份若被判爭議、撤掉答案，這一題也不會整個消失。
 * 認不得的來源回傳空陣列（matchesSource 是 fail-closed），呼叫端必須處理「一題都沒有」。
 */
export function sourceCandidates(
  pool: readonly QuizQuestion[],
  subject: ExamSubject | 'all',
  source: QuestionSource
): QuizQuestion[] {
  const picked = pool.filter(
    (q) =>
      (subject === 'all' || q.subject === subject) &&
      matchesSource(q, source) &&
      isQuestionScorable(q)
  );
  return dedupeByContent(picked.sort(byPaperOrder));
}

/** 這個來源的名單（id）；兩邊都有的題目只算一次 */
export function reviewIds(source: ReviewSource, review: Pick<ReviewSnapshot, 'stars' | 'wrong'>): string[] {
  const stars = Object.keys(review.stars);
  const wrong = Object.keys(review.wrong);
  if (source === 'review:starred') return stars;
  if (source === 'review:wrong') return wrong;
  return [...new Set([...stars, ...wrong])];
}

/**
 * 星號與待複習錯題的抽題範圍：pool 裡在名單上、考科相符、有標準答案的題目，順序與去重都跟 sourceCandidates 相同。
 * 名單上認不得的 id（題庫改過、練習池沒載入）在這裡被過濾掉，名單本身不動。
 */
export function reviewCandidates(
  pool: readonly QuizQuestion[],
  subject: ExamSubject | 'all',
  source: ReviewSource,
  review: Pick<ReviewSnapshot, 'stars' | 'wrong'>
): QuizQuestion[] {
  const ids = new Set(reviewIds(source, review));
  const picked = pool.filter(
    (q) => ids.has(q.id) && (subject === 'all' || q.subject === subject) && isQuestionScorable(q)
  );
  return dedupeByContent(picked.sort(byPaperOrder));
}
