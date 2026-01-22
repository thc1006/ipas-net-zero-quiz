// 題庫資料模組測試
import { describe, it, expect } from 'vitest';
import {
  stats,
  allQuestions,
  subject1Questions,
  subject2Questions,
  questionsWithAnswer,
  getQuestionsBySubject,
  getRandomQuestions,
  getQuestionById,
  searchQuestions,
  getSimilarQuestions,
} from './questions';

describe('題庫資料模組', () => {
  describe('stats 統計資料', () => {
    it('應該有正確的總題數', () => {
      expect(stats.total).toBe(719);
    });

    it('考科一和考科二題數加總應等於總題數', () => {
      expect(stats.subject1 + stats.subject2).toBe(stats.total);
    });

    it('gist 和 unique 題數加總應等於總題數', () => {
      expect(stats.gistCount + stats.uniqueCount).toBe(stats.total);
    });

    it('有答案的題目數應為正數', () => {
      expect(stats.withAnswer).toBeGreaterThan(0);
    });
  });

  describe('allQuestions 轉換結果', () => {
    it('轉換後題目數應等於總題數', () => {
      expect(allQuestions.length).toBe(stats.total);
    });

    it('每題應有必要欄位', () => {
      const sample = allQuestions[0];
      expect(sample).toHaveProperty('id');
      expect(sample).toHaveProperty('stem');
      expect(sample).toHaveProperty('options');
      expect(sample).toHaveProperty('subject');
      expect(sample).toHaveProperty('sourceType');
      expect(sample).toHaveProperty('hasAnswer');
    });

    it('每題應有四個選項', () => {
      const sampleSize = Math.min(50, allQuestions.length);
      for (let i = 0; i < sampleSize; i++) {
        expect(allQuestions[i].options.length).toBe(4);
      }
    });

    it('選項 key 應為 A/B/C/D', () => {
      const sample = allQuestions[0];
      const keys = sample.options.map((o) => o.key);
      expect(keys).toContain('A');
      expect(keys).toContain('B');
      expect(keys).toContain('C');
      expect(keys).toContain('D');
    });
  });

  describe('subject1Questions / subject2Questions', () => {
    it('考科一題目數應正確', () => {
      expect(subject1Questions.length).toBe(stats.subject1);
    });

    it('考科二題目數應正確', () => {
      expect(subject2Questions.length).toBe(stats.subject2);
    });

    it('所有考科一題目的 subject 應為 考科1', () => {
      subject1Questions.forEach((q) => {
        expect(q.subject).toBe('考科1');
      });
    });

    it('所有考科二題目的 subject 應為 考科2', () => {
      subject2Questions.forEach((q) => {
        expect(q.subject).toBe('考科2');
      });
    });
  });

  describe('questionsWithAnswer', () => {
    it('有答案題目數應等於 stats.withAnswer', () => {
      expect(questionsWithAnswer.length).toBe(stats.withAnswer);
    });

    it('所有有答案的題目 hasAnswer 應為 true', () => {
      questionsWithAnswer.forEach((q) => {
        expect(q.hasAnswer).toBe(true);
        expect(q.answer).not.toBeNull();
      });
    });
  });

  describe('getQuestionsBySubject', () => {
    it('取得全部題目', () => {
      const result = getQuestionsBySubject('all');
      expect(result.length).toBe(stats.total);
    });

    it('取得考科一題目', () => {
      const result = getQuestionsBySubject('考科1');
      expect(result.length).toBe(stats.subject1);
    });

    it('取得考科二題目', () => {
      const result = getQuestionsBySubject('考科2');
      expect(result.length).toBe(stats.subject2);
    });
  });

  describe('getRandomQuestions', () => {
    it('應回傳指定數量的題目', () => {
      const result = getRandomQuestions(10);
      expect(result.length).toBe(10);
    });

    it('應回傳隨機順序（多次呼叫結果不同）', () => {
      const result1 = getRandomQuestions(50).map((q) => q.id);
      const result2 = getRandomQuestions(50).map((q) => q.id);
      // 50 題隨機抽取，兩次結果完全相同的機率極低
      expect(result1).not.toEqual(result2);
    });

    it('限定考科時應只回傳該考科題目', () => {
      const result = getRandomQuestions(20, '考科1');
      result.forEach((q) => {
        expect(q.subject).toBe('考科1');
      });
    });

    it('onlyWithAnswer 時應只回傳有答案的題目', () => {
      const result = getRandomQuestions(20, 'all', true);
      result.forEach((q) => {
        expect(q.hasAnswer).toBe(true);
      });
    });

    it('要求數量超過可用題目時應回傳全部可用題目', () => {
      const result = getRandomQuestions(10000);
      expect(result.length).toBe(stats.total);
    });
  });

  describe('getQuestionById', () => {
    it('應能找到存在的題目', () => {
      const firstQuestion = allQuestions[0];
      const result = getQuestionById(firstQuestion.id);
      expect(result).toBeDefined();
      expect(result?.id).toBe(firstQuestion.id);
    });

    it('找不到時應回傳 undefined', () => {
      const result = getQuestionById('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('searchQuestions', () => {
    it('應能搜尋到包含關鍵字的題目', () => {
      // 使用一個常見的關鍵字
      const result = searchQuestions('碳');
      expect(result.length).toBeGreaterThan(0);
      result.forEach((q) => {
        expect(q.stem.toLowerCase()).toContain('碳');
      });
    });

    it('空關鍵字應回傳空陣列', () => {
      const result = searchQuestions('');
      expect(result).toEqual([]);
    });

    it('找不到結果應回傳空陣列', () => {
      const result = searchQuestions('xyzabc123不存在的關鍵字');
      expect(result).toEqual([]);
    });
  });

  describe('getSimilarQuestions', () => {
    it('應回傳相似題目（不包含自己）', () => {
      const question = allQuestions[0];
      const result = getSimilarQuestions(question.id, 5);
      // 結果不應包含原題目
      result.forEach((q) => {
        expect(q.id).not.toBe(question.id);
      });
    });

    it('應限制回傳數量', () => {
      const question = allQuestions[0];
      const result = getSimilarQuestions(question.id, 3);
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it('找不到題目時應回傳空陣列', () => {
      const result = getSimilarQuestions('non-existent-id');
      expect(result).toEqual([]);
    });
  });
});
