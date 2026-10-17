// 題目來源（#128「只出官方題目」）：一題算不算某個來源、來源在畫面上的名稱、原卷的順序、抽題範圍。
//
// 判斷依據只有資料上的官方標記 officialExam（由 tools/import_official_exam.py 從官方 PDF 匯入時寫入），
// 不看題號、不看題目文字：同一題拿掉標記就不算官方題。認不得的來源一題都不收（fail-closed），
// 不會悄悄退回「全部題目」，否則使用者以為自己在練官方題，實際上混進了非官方的題目。
import type { ExamSubject, QuestionSource, QuizQuestion } from '../types/quiz';
import { sessionLabel } from './official-exam';
import { dedupeByContent } from './question-identity';
import { isQuestionScorable } from './scorable';

/** 這一題算不算 source 這個來源 */
export function matchesSource(q: QuizQuestion, source: QuestionSource): boolean {
  if (source === 'all') return true;
  const exam = q.officialExam;
  if (!exam) return false;
  if (source === 'official') return true;
  // 場次格式不另外驗：比的是資料上的場次，那裡的格式由 schema 守（main-bank.schema.json）
  if (source.startsWith('exam:')) return exam.session === source.slice('exam:'.length);
  return false;
}

/** 題庫裡有哪幾場官方公告試題，新到舊排列（選單的順序） */
export function officialSessions(questions: readonly QuizQuestion[]): string[] {
  const sessions = new Set<string>();
  for (const q of questions) if (q.officialExam) sessions.add(q.officialExam.session);
  return [...sessions].sort().reverse();
}

/** 來源在畫面上的名稱；某一場的寫法與題卡上的標籤相同（「115 年第一次官方公告試題」） */
export function questionSourceLabel(source: QuestionSource): string {
  if (source === 'all') return '全部題目';
  if (source === 'official') return '官方公告試題（全部場次）';
  return `${sessionLabel(source.slice('exam:'.length))}官方公告試題`;
}

/**
 * 原卷順序：場次（舊到新）、科目（第一科在前）、題號。沒有官方標記的題目排在最後、彼此相等
 * （sort 是穩定的，所以維持原順序）。混著兩種題目時也必須是一致的比較函式：ECMA-262 規定比較函式
 * 不一致時，Array.prototype.sort 的結果由實作決定。
 */
export function byPaperOrder(a: QuizQuestion, b: QuizQuestion): number {
  const x = a.officialExam;
  const y = b.officialExam;
  if (!x || !y) return (x ? 0 : 1) - (y ? 0 : 1);
  // 場次 115-01 與科目 L11 都是定寬代號（schema 的 pattern），字串順序就是時間與科目順序
  if (x.session !== y.session) return x.session < y.session ? -1 : 1;
  if (x.subject !== y.subject) return x.subject < y.subject ? -1 : 1;
  return x.question_number - y.question_number;
}

/**
 * 只出官方題目時的抽題範圍：pool 裡帶對應官方標記、考科相符、有標準答案的題目，
 * 照原卷順序排列，依內容去重。
 *
 * 先拿掉沒有標準答案的題目，再排序、去重：同一題在兩場都出過時，留下最早一場有答案的那一題，
 * 與匯入的先後無關；最早那一場若被判爭議、撤掉答案，這一題也不會整個消失。
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
