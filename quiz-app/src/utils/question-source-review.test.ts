// 星號與待複習錯題當成題目來源：名單在使用者手上，不在題目資料上。
import { describe, expect, it } from 'vitest';
import {
  REVIEW_SOURCES,
  isReviewSource,
  matchesSource,
  questionSourceLabel,
  questionSourceNoun,
  questionSourceScope,
  reviewCandidates,
  reviewEmptyHint,
  reviewIds,
  reviewOptionLabel,
} from './question-source';
import type { QuizQuestion } from '../types/quiz';

const q = (id: string, over: Partial<QuizQuestion> = {}): QuizQuestion => ({
  id,
  stem: `題幹 ${id}`,
  options: [
    { key: 'A', text: `選項 ${id} A` },
    { key: 'B', text: `選項 ${id} B` },
  ],
  answer: 'A',
  subject: '考科1',
  sourceType: 'unique',
  year: null,
  hasAnswer: true,
  ...over,
});

const review = (stars: string[], wrong: string[] = []) => ({
  stars: Object.fromEntries(stars.map((id) => [id, 1])),
  wrong: Object.fromEntries(wrong.map((id) => [id, { streak: 0, last: 1 }])),
});

describe('isReviewSource', () => {
  it('只認三個值', () => {
    expect(REVIEW_SOURCES).toEqual(['review:starred', 'review:wrong', 'review:both']);
    for (const s of REVIEW_SOURCES) expect(isReviewSource(s)).toBe(true);
    for (const s of ['all', 'official', 'exam:115-01', 'review:', 'review:other', 5, undefined, null]) {
      expect(isReviewSource(s)).toBe(false);
    }
  });
});

describe('reviewIds', () => {
  const r = review(['a', 'b'], ['b', 'c']);
  it('星號、待複習、兩者聯集（兩邊都有的只算一次）', () => {
    expect(reviewIds('review:starred', r)).toEqual(['a', 'b']);
    expect(reviewIds('review:wrong', r)).toEqual(['b', 'c']);
    expect(reviewIds('review:both', r)).toEqual(['a', 'b', 'c']);
  });
});

describe('reviewCandidates', () => {
  const pool = [q('a'), q('b', { subject: '考科2' }), q('c'), q('p', { sourceType: 'practice_pool', subject: null })];

  it('星號題：只有加星號的', () => {
    expect(reviewCandidates(pool, 'all', 'review:starred', review(['a', 'c'], ['b'])).map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('待複習錯題：只有錯題', () => {
    expect(reviewCandidates(pool, 'all', 'review:wrong', review(['a'], ['b', 'c'])).map((x) => x.id)).toEqual(['b', 'c']);
  });

  it('兩者：同一題只算一次', () => {
    expect(reviewCandidates(pool, 'all', 'review:both', review(['a', 'c'], ['a', 'b'])).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('跟考科組合；考科對不上（含練習池沒有考科的題目）不出', () => {
    const r = review(['a', 'b', 'p']);
    expect(reviewCandidates(pool, '考科1', 'review:starred', r).map((x) => x.id)).toEqual(['a']);
    expect(reviewCandidates(pool, '考科2', 'review:starred', r).map((x) => x.id)).toEqual(['b']);
    expect(reviewCandidates(pool, 'all', 'review:starred', r).map((x) => x.id)).toEqual(['a', 'b', 'p']);
  });

  it('不能計分的題目不出，名單留著', () => {
    const bank = [q('a', { answer: null }), q('b', { qualityFlags: ['disputed_answer'] }), q('c')];
    expect(reviewCandidates(bank, 'all', 'review:starred', review(['a', 'b', 'c'])).map((x) => x.id)).toEqual(['c']);
  });

  it('認不得的 id 不出、也不會出錯', () => {
    expect(reviewCandidates(pool, 'all', 'review:starred', review(['ghost', 'a'])).map((x) => x.id)).toEqual(['a']);
  });

  it('依內容去重：跨科重複的題目只留第一個', () => {
    const bank = [q('a'), { ...q('a2', { subject: '考科2' }), stem: q('a').stem, options: q('a').options }];
    expect(reviewCandidates(bank, 'all', 'review:starred', review(['a', 'a2'])).map((x) => x.id)).toEqual(['a']);
  });

  it('順序與官方題目同一套：原卷順序，非官方題維持原順序排在後面', () => {
    const exam = (session: string, n: number) => ({
      officialExam: { session, subject: 'L11', question_number: n },
    });
    const bank = [
      q('plain-1'),
      q('new', exam('115-02', 1) as Partial<QuizQuestion>),
      q('plain-2'),
      q('old', exam('115-01', 2) as Partial<QuizQuestion>),
    ];
    const ids = reviewCandidates(bank, 'all', 'review:starred', review(['plain-1', 'new', 'plain-2', 'old']));
    expect(ids.map((x) => x.id)).toEqual(['old', 'new', 'plain-1', 'plain-2']);
  });

  it('不改動傳進來的題庫陣列（sort 是原地排序）', () => {
    const bank = [q('b'), q('a')];
    reviewCandidates(bank, 'all', 'review:starred', review(['a', 'b']));
    expect(bank.map((x) => x.id)).toEqual(['b', 'a']);
  });
});

describe('名稱與提示', () => {
  it('matchesSource 對這三個來源一題都不收：名單不是題目的屬性', () => {
    for (const s of REVIEW_SOURCES) expect(matchesSource(q('a'), s)).toBe(false);
  });

  it('選單名稱', () => {
    expect(questionSourceLabel('review:starred')).toBe('星號題');
    expect(questionSourceLabel('review:wrong')).toBe('待複習錯題');
    expect(questionSourceLabel('review:both')).toBe('星號 + 待複習錯題');
  });

  it('選單名稱帶題數；題數還不知道時不寫數字', () => {
    expect(reviewOptionLabel('review:starred', 12)).toBe('星號題（12 題）');
    expect(reviewOptionLabel('review:wrong', 30)).toBe('待複習錯題（30 題）');
    expect(reviewOptionLabel('review:both', 38)).toBe('星號 + 待複習錯題（38 題）');
    expect(reviewOptionLabel('review:both', 0)).toBe('星號 + 待複習錯題（0 題）');
    expect(reviewOptionLabel('review:starred', null)).toBe('星號題（載入中）');
  });

  it('稱呼', () => {
    expect(questionSourceNoun('review:starred')).toBe('星號題');
    expect(questionSourceNoun('review:wrong')).toBe('待複習錯題');
    expect(questionSourceNoun('review:both')).toBe('星號題與待複習錯題');
    expect(questionSourceScope('review:both')).toBe('');
  });

  it('空的時候說怎麼把題目加進來', () => {
    expect(reviewEmptyHint('review:starred', false)).toMatch(/星號/);
    expect(reviewEmptyHint('review:wrong', false)).toMatch(/答錯/);
    expect(reviewEmptyHint('review:both', false)).toMatch(/星號.*答錯/);
  });

  it('別的考科有題目時，說的是換考科範圍', () => {
    expect(reviewEmptyHint('review:starred', true)).toMatch(/考科範圍/);
    expect(reviewEmptyHint('review:wrong', true)).toMatch(/考科範圍/);
  });
});
