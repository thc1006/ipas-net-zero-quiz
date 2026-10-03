// 「什麼算同一道題」的正規化：執行期的去重與 CI 的重複／衝突檢查共用 normalizeText()。
// 兩個方向都要釘住：該相同的相同（否則重複漏網），該不同的不同（否則誤報，或把兩個答案當成一個）。
import { describe, it, expect } from 'vitest';
import { contentSignature, normalizeText } from './question-identity';

describe('normalizeText', () => {
  it.each([
    ['58.8tCO₂e', '5.88tCO₂e'],
    ['3.14', '31.4'],
    ['1.5 與 2.5', '1.5 與 25'], // 第二個小數點也要受保護（不是只換第一個）
    ['５８.８', '5.88'], // 全形數字的小數點也是小數點
    ['排放量 = 活動數據 × 排放係數', '排放量 = 活動數據 + 排放係數'],
  ])('%s 與 %s 是不同的', (a, b) => {
    expect(normalizeText(a)).not.toBe(normalizeText(b));
  });

  it.each([
    ['「混合法」', '“混合法”'],
    ['2024 年 1\u20113 月', '2024年1\u20133月'],
    ['1,000 公噸', '1000公噸'],
    ['目標年為 2030.', '目標年為 2030'],
    ['5.88 tCO₂e；', '5.88tCO₂e'],
    ['５８.８', '58.8'], // NFKC 必須在剝標點之前：否則全形數字之間的小數點先被剝掉
    ['附件 B.1', '附件 B1'], // 只有「兩邊都是數字」的點才是小數點
    ['第 1. 5 項', '第 15 項'], // 也只有單獨一個「.」：句點後面接空白的不是小數點
    ['ｔＣＯ２ｅ', 'tCO2e'],
    ['TCO2E', 'tco2e'],
  ])('%s 與 %s 是同一個', (a, b) => {
    expect(normalizeText(a)).toBe(normalizeText(b));
  });

  it('null 與 undefined 當成空字串', () => {
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
  });
});

describe('contentSignature', () => {
  const q = (stem: string, texts: string[]) => ({ stem, options: texts.map((text) => ({ text })) });

  it('選項換順序還是同一題', () => {
    expect(contentSignature(q('題幹', ['甲', '乙', '丙', '丁']))).toBe(
      contentSignature(q('題幹', ['丁', '丙', '乙', '甲']))
    );
  });

  it('只差一個選項的小數點位置，是兩道不同的題', () => {
    expect(contentSignature(q('排放量為何？', ['58.8', '5.88', '0.588', '588']))).not.toBe(
      contentSignature(q('排放量為何？', ['58.8', '58.8', '0.588', '588']))
    );
  });
});
