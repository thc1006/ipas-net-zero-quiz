// 題目來源（#128「只出官方題目」）：一題算不算某個來源、來源在畫面上的名稱、原卷的順序。
// 判斷依據只有資料上的官方標記（officialExam），不看題號、不看文字。
import { describe, it, expect } from 'vitest';
import { allQuestions } from '../data/questions';
import type { ExamSubject, QuizQuestion } from '../types/quiz';
import {
  byPaperOrder,
  matchesSource,
  officialSessions,
  questionSourceLabel,
  sourceCandidates,
} from './question-source';

const official = allQuestions.filter((q) => q.officialExam);
const nonOfficial = allQuestions.filter((q) => !q.officialExam);

describe('一題算不算某個來源：只看資料上的官方標記', () => {
  it('這道 gate 不能空轉：題庫裡官方與非官方的題目各至少 40 題（下面混著排序的測試各取 40 題），官方題至少兩場', () => {
    expect(official.length).toBeGreaterThanOrEqual(40);
    expect(nonOfficial.length).toBeGreaterThanOrEqual(40);
    expect(officialSessions(allQuestions).length).toBeGreaterThanOrEqual(2);
  });

  it("'all' 收每一題", () => {
    expect(allQuestions.every((q) => matchesSource(q, 'all'))).toBe(true);
  });

  it("'official' 只收帶官方公告試題標記的題目", () => {
    expect(official.every((q) => matchesSource(q, 'official'))).toBe(true);
    expect(nonOfficial.filter((q) => matchesSource(q, 'official'))).toEqual([]);
  });

  it("'exam:<場次>' 只收那一場，而且一題不漏", () => {
    for (const session of officialSessions(allQuestions)) {
      const hit = allQuestions.filter((q) => matchesSource(q, `exam:${session}`));
      expect(hit.length).toBeGreaterThan(0);
      expect(hit.filter((q) => q.officialExam?.session !== session)).toEqual([]);
      expect(hit.length).toBe(official.filter((q) => q.officialExam!.session === session).length);
    }
  });

  it('同一題拿掉官方標記就不算：不是靠題號或題目文字認的', () => {
    const q = official[0];
    const stripped: QuizQuestion = { ...q, officialExam: undefined };
    expect(matchesSource(stripped, 'official')).toBe(false);
    expect(matchesSource(stripped, `exam:${q.officialExam!.session}`)).toBe(false);
  });

  it('寫錯的來源一題都不收（fail-closed），不會退回成全部題目', () => {
    for (const bad of ['', 'Official', 'exam:', 'exam:115-1', 'exam:999-01', 'Exam:115-01', 'sample:114']) {
      expect(allQuestions.filter((q) => matchesSource(q, bad as never))).toEqual([]);
    }
  });
});

describe('官方公告試題的場次', () => {
  it('由資料算出，新到舊排列，不重複', () => {
    const sessions = officialSessions(allQuestions);
    expect(new Set(sessions).size).toBe(sessions.length);
    expect([...sessions].sort().reverse()).toEqual(sessions);
    expect(new Set(official.map((q) => q.officialExam!.session))).toEqual(new Set(sessions));
  });

  it('題目的先後不是時間順序時，一樣新到舊（真資料剛好已經照時間排，驗不出這件事）', () => {
    const at = (session: string): QuizQuestion => ({ ...official[0], officialExam: { ...official[0].officialExam!, session } });
    expect(officialSessions([at('115-01'), at('114-02'), at('115-02'), at('114-02')])).toEqual(['115-02', '115-01', '114-02']);
  });
});

describe('來源在畫面上的名稱', () => {
  it('全部題目、官方公告試題、某一場公告試題', () => {
    expect(questionSourceLabel('all')).toBe('全部題目');
    expect(questionSourceLabel('official')).toBe('官方公告試題（全部場次）');
    expect(questionSourceLabel('exam:115-01')).toBe('115 年第一次官方公告試題');
    expect(questionSourceLabel('exam:115-02')).toBe('115 年第二次官方公告試題');
  });
});

describe('原卷順序：場次、科目、題號', () => {
  it('比較函式反對稱：兩題對調，結果的正負號也對調（官方題之間、官方題與非官方題之間）', () => {
    const sign = (n: number) => Math.sign(n) + 0;
    const sample = [...official.slice(0, 30), ...nonOfficial.slice(0, 10)];
    for (const a of sample) {
      for (const b of sample) expect(sign(byPaperOrder(a, b))).toBe(-sign(byPaperOrder(b, a)) + 0);
    }
    expect(sign(byPaperOrder(official[0], nonOfficial[0]))).toBe(-1);
  });

  it('混著非官方題也有確定的結果：官方題在前照原卷順序，非官方題在後、維持原順序', () => {
    // 官方題倒過來、與非官方題交錯：比較函式若對「一官方一非官方」回傳 0，
    // 相鄰兩題永遠比不出先後，官方題會原封不動留在倒序
    const reversed = [...official].sort(byPaperOrder).reverse().slice(0, 40);
    const others = nonOfficial.slice(0, 40);
    const mixed = reversed.flatMap((q, i) => [others[i], q]);
    const sorted = [...mixed].sort(byPaperOrder);
    expect(sorted.slice(0, 40).map((q) => q.id)).toEqual([...reversed].reverse().map((q) => q.id));
    expect(sorted.slice(40).map((q) => q.id)).toEqual(others.map((q) => q.id));
  });

  it('依場次（舊到新）、科目（第一科在前）、題號排列', () => {
    const sorted = [...official].sort(() => Math.random() - 0.5).sort(byPaperOrder);
    const key = (q: QuizQuestion) =>
      [q.officialExam!.session, q.officialExam!.subject, String(q.officialExam!.question_number).padStart(3, '0')].join(
        '|'
      );
    const keys = sorted.map(key);
    expect(keys).toEqual([...keys].sort());
    expect(sorted.length).toBe(official.length);
  });
});

describe('抽題範圍 sourceCandidates', () => {
  // 現有的官方題剛好沒有跨場重複、沒有無答案題，匯入順序也就是原卷順序：只用真資料驗，
  // 拿掉排序、去重或「只留有標準答案的題」都不會轉紅。這裡自己擺出這些情況。
  const ordered = [...official].sort(byPaperOrder);
  const [a, b, c] = ordered;
  const later = (q: QuizQuestion, id: string): QuizQuestion => ({
    ...q,
    id,
    officialExam: { ...q.officialExam!, session: '999-01' },
  });
  const unanswered = (q: QuizQuestion, id: string): QuizQuestion => ({ ...q, id, answer: null, hasAnswer: false });

  it('匯入順序亂、跨場重複、無答案題：照原卷順序，重複的留最早那一場，無答案題不出', () => {
    // 同一題在較晚的一場又出一次（內容相同、場次不同）
    const reused = later(a, 'fixture-reused');
    // 被判爭議、撤掉答案的官方題（內容與 c 不同，才不會被當成重複）
    const disputed = {
      ...unanswered(c, 'fixture-disputed'),
      stem: `${c.stem}（爭議題）`,
      officialExam: { ...c.officialExam!, question_number: 999 },
    };
    const pool = [nonOfficial[0], reused, disputed, c, b, a];
    expect(sourceCandidates(pool, 'all', 'official').map((q) => q.id)).toEqual([a.id, b.id, c.id]);
  });

  it('同一題最早那一場被撤掉答案時，留下較晚一場有答案的那一題，不會整題消失', () => {
    const pool = [unanswered(a, 'fixture-early-unanswered'), later(a, 'fixture-late-answered')];
    expect(sourceCandidates(pool, 'all', 'official').map((q) => q.id)).toEqual(['fixture-late-answered']);
    expect(sourceCandidates(pool, 'all', 'exam:999-01').map((q) => q.id)).toEqual(['fixture-late-answered']);
  });

  it('考科不符的不收', () => {
    const subject = a.subject as ExamSubject;
    const other: ExamSubject = subject === '考科1' ? '考科2' : '考科1';
    expect(sourceCandidates([a], other, 'official')).toEqual([]);
    expect(sourceCandidates([a], subject, 'official').map((q) => q.id)).toEqual([a.id]);
  });
});
