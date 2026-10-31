// 題目來源（#128「只出官方題目」）：一題算不算某個來源、來源在畫面上的名稱、原卷的順序。
// 判斷依據只有資料上的官方標記（officialExam、officialSample），不看題號、不看文字。
import { describe, it, expect } from 'vitest';
import { allQuestions } from '../data/questions';
import type { ExamSubject, QuizQuestion } from '../types/quiz';
import {
  byPaperOrder,
  matchesSource,
  officialSessions,
  questionSourceLabel,
  questionSourceNoun,
  questionSourceScope,
  sampleEditions,
  sourceCandidates,
} from './question-source';

const official = allQuestions.filter((q) => q.officialExam);
const samples = allQuestions.filter((q) => q.officialSample);
const nonOfficial = allQuestions.filter((q) => !q.officialExam && !q.officialSample);

describe('一題算不算某個來源：只看資料上的官方標記', () => {
  it('這道 gate 不能空轉：題庫裡官方與非官方的題目各至少 40 題（下面混著排序的測試各取 40 題），官方題至少兩場，也有參考樣題', () => {
    expect(official.length).toBeGreaterThanOrEqual(40);
    expect(nonOfficial.length).toBeGreaterThanOrEqual(40);
    expect(officialSessions(allQuestions).length).toBeGreaterThanOrEqual(2);
    expect(samples.length).toBeGreaterThan(0);
  });

  it("'all' 收每一題", () => {
    expect(allQuestions.every((q) => matchesSource(q, 'all'))).toBe(true);
  });

  it("'official' 收帶官方標記的題目（公告試題與參考樣題），其他一題都不收", () => {
    expect(official.every((q) => matchesSource(q, 'official'))).toBe(true);
    expect(samples.every((q) => matchesSource(q, 'official'))).toBe(true);
    expect(nonOfficial.filter((q) => matchesSource(q, 'official'))).toEqual([]);
  });

  it("'sample:<版次>' 只收那一版參考樣題，而且一題不漏；公告試題不算", () => {
    for (const edition of sampleEditions(allQuestions)) {
      const hit = allQuestions.filter((q) => matchesSource(q, `sample:${edition}`));
      expect(hit.length).toBeGreaterThan(0);
      expect(hit.filter((q) => q.officialSample?.edition !== edition)).toEqual([]);
      expect(hit.length).toBe(samples.filter((q) => q.officialSample!.edition === edition).length);
    }
    expect(samples.filter((q) => matchesSource(q, `exam:${q.officialSample!.edition}-01`))).toEqual([]);
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
    const s = samples[0];
    const unmarked: QuizQuestion = { ...s, officialSample: undefined };
    expect(matchesSource(unmarked, 'official')).toBe(false);
    expect(matchesSource(unmarked, `sample:${s.officialSample!.edition}`)).toBe(false);
  });

  it('寫錯的來源一題都不收（fail-closed），不會退回成全部題目', () => {
    for (const bad of ['', 'Official', 'exam:', 'exam:115-1', 'exam:999-01', 'Exam:115-01', 'exam:114',
      'sample:', 'sample:999', 'Sample:114', 'sample:114 ', 'sample:115-01', 'samples:114']) {
      expect(allQuestions.filter((q) => matchesSource(q, bad as never)), bad).toEqual([]);
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

describe('參考樣題的版次', () => {
  it('由資料算出，新到舊排列，不重複', () => {
    const editions = sampleEditions(allQuestions);
    expect(new Set(editions).size).toBe(editions.length);
    expect(new Set(samples.map((q) => q.officialSample!.edition))).toEqual(new Set(editions));
    const at = (edition: string): QuizQuestion => ({ ...samples[0], officialSample: { ...samples[0].officialSample!, edition } });
    expect(sampleEditions([at('114'), at('116'), at('115'), at('114')])).toEqual(['116', '115', '114']);
    expect(sampleEditions(official)).toEqual([]);
  });
});

describe('來源在畫面上的名稱', () => {
  // 選單上的名稱比題卡的標籤短：某一場、某一版不寫「官方」（手機寬度、最大字級也要完整顯示）
  it('全部題目、全部官方題目、某一場公告試題、某一版參考樣題', () => {
    expect(questionSourceLabel('all')).toBe('全部題目');
    expect(questionSourceLabel('official')).toBe('全部官方題目');
    expect(questionSourceLabel('exam:115-01')).toBe('115 年第一次公告試題');
    expect(questionSourceLabel('exam:115-02')).toBe('115 年第二次公告試題');
    expect(questionSourceLabel('sample:114')).toBe('參考樣題（114 年版）');
  });

  it('全部官方題目的範圍寫在說明文字裡，其他來源不補', () => {
    expect(questionSourceScope('official')).toBe('（公告試題與參考樣題）');
    for (const source of ['all', 'exam:115-01', 'sample:114'] as const)
      expect(questionSourceScope(source)).toBe('');
  });

  it('說明文字裡的稱呼', () => {
    expect(questionSourceNoun('all')).toBe('題目');
    expect(questionSourceNoun('official')).toBe('官方題目');
    expect(questionSourceNoun('exam:115-01')).toBe('官方公告試題');
    expect(questionSourceNoun('sample:114')).toBe('參考樣題');
  });
});

describe('原卷順序：卷（舊到新，同一年參考樣題在前）、科目、題號', () => {
  it('比較函式反對稱：兩題對調，結果的正負號也對調（官方題之間、參考樣題與公告試題之間、官方題與非官方題之間）', () => {
    const sign = (n: number) => Math.sign(n) + 0;
    const sample = [...official.slice(0, 30), ...samples, ...nonOfficial.slice(0, 10)];
    for (const a of sample) {
      for (const b of sample) expect(sign(byPaperOrder(a, b))).toBe(-sign(byPaperOrder(b, a)) + 0);
    }
    expect(sign(byPaperOrder(official[0], nonOfficial[0]))).toBe(-1);
    expect(sign(byPaperOrder(samples[0], nonOfficial[0]))).toBe(-1);
  });

  it('參考樣題排在同一年與之後的公告試題之前，之前年份的公告試題之後', () => {
    const s = samples.find((q) => q.officialSample!.subject === 'L12')!;
    const e = official.find((q) => q.officialExam!.subject === 'L11')!;
    const exam = (session: string): QuizQuestion => ({ ...e, officialExam: { ...e.officialExam!, session } });
    const sample = (edition: string): QuizQuestion => ({ ...s, officialSample: { ...s.officialSample!, edition } });
    // 第二科的參考樣題、第一科的公告試題：比的是年份與種類，不是科目
    expect(byPaperOrder(sample('115'), exam('115-01'))).toBeLessThan(0);
    expect(byPaperOrder(exam('115-01'), sample('115'))).toBeGreaterThan(0);
    expect(byPaperOrder(sample('116'), exam('115-02'))).toBeGreaterThan(0);
    expect(byPaperOrder(sample('114'), sample('115'))).toBeLessThan(0);
    expect(byPaperOrder(sample('115'), { ...sample('115'), officialSample: { ...s.officialSample!, edition: '115', subject: 'L11' } })).toBeGreaterThan(0);
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

  it('依卷（舊到新，同一年參考樣題在前）、科目（第一科在前）、題號排列', () => {
    const both = [...official, ...samples];
    const sorted = [...both].sort(() => Math.random() - 0.5).sort(byPaperOrder);
    const key = (q: QuizQuestion) => {
      const o = q.officialExam ?? q.officialSample!;
      const paper = q.officialExam ? q.officialExam.session : `${q.officialSample!.edition}-00`;
      return [paper, o.subject, String(o.question_number).padStart(3, '0')].join('|');
    };
    const keys = sorted.map(key);
    expect(keys).toEqual([...keys].sort());
    expect(sorted.length).toBe(both.length);
    expect(sorted[0].officialSample?.edition).toBe('114');
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

  it('同一題先出在參考樣題、後來又出在公告試題：全部官方題目留下參考樣題那一題，只出那一場時照出', () => {
    const s = samples.find((q) => q.hasAnswer)!;
    const inExam: QuizQuestion = {
      ...s,
      id: 'fixture-exam-copy',
      officialSample: undefined,
      officialExam: { session: '115-01', exam_date: '2026-05-16', subject: s.officialSample!.subject, question_number: 1 },
    };
    expect(sourceCandidates([inExam, s], 'all', 'official').map((q) => q.id)).toEqual([s.id]);
    expect(sourceCandidates([inExam, s], 'all', 'exam:115-01').map((q) => q.id)).toEqual(['fixture-exam-copy']);
  });

  // getSourceCandidates 傳進來的是 allQuestions：就地排序的話，主題庫的順序跟著被改掉
  it('不動傳進來的陣列', () => {
    const pool = [...allQuestions].reverse();
    const before = pool.map((q) => q.id);
    sourceCandidates(pool, 'all', 'official');
    expect(pool.map((q) => q.id)).toEqual(before);
  });

  it('考科不符的不收', () => {
    const subject = a.subject as ExamSubject;
    const other: ExamSubject = subject === '考科1' ? '考科2' : '考科1';
    expect(sourceCandidates([a], other, 'official')).toEqual([]);
    expect(sourceCandidates([a], subject, 'official').map((q) => q.id)).toEqual([a.id]);
  });
});
