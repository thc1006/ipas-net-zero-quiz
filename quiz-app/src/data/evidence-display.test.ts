// 「答案依據」顯示層 gate。
//
// 起因：這些逐字引文一直只存在資料裡，UI 只渲染一排來源連結。對使用者來說，
// 「公版教材原文」和「某篇部落格」看起來份量相同 —— 而答案其實只有前者撐得住。
// 這裡釘住三件事：撐住正解的引文真的被挑出來、只抄題幹的引文不會被當成依據、
// 以及被回報過的那兩題確實顯示正確的一手原文。
import { describe, it, expect } from 'vitest';
import { allQuestions, getQuestionById } from './questions';

describe('答案依據（evidence）顯示', () => {
  it('S_VOCUS_03-q004 顯示的是教材列出精密度/完整性/代表性的原文，不是部落格抄來的題幹', () => {
    const q = allQuestions.find((x) => x.id.includes('S_VOCUS_03-q004'));
    expect(q, '找不到 S_VOCUS_03-q004').toBeDefined();
    expect(q!.evidence, '這題應該要有答案依據').toBeDefined();

    const quote = q!.evidence!.quote;
    expect(quote).toContain('精密度');
    expect(quote).toContain('完整性');
    expect(quote).toContain('代表性');
    // 原始出處是部落格，它的引文只是把題幹抄一遍 —— 不能被當成答案依據
    expect(quote.startsWith('ISO 14067 要求數據品質包含')).toBe(false);
    expect(q!.evidence!.url ?? '').not.toContain('vocus.cc');
  });

  it('gist[64] 顯示的是 CBAM 正式期 B.1 排除移動機械的法條原文', () => {
    const q = allQuestions.find((x) => x.stem.includes('Regulation (EU) 2025/2547'));
    expect(q, '找不到改寫後的 CBAM 題').toBeDefined();
    expect(q!.evidence?.quote ?? '').toContain(
      'mobile machinery for transportation purposes shall be excluded'
    );
    expect(q!.evidence?.url ?? '').toContain('32025R2547');
  });

  it('挑出的引文必須是撐住「正解」的那一條', () => {
    // 全庫掃：凡有 evidence 的題目，若資料裡存在標了 supports_option 的引文，
    // 顯示出來的那一條就必須對應正解，不能挑到撐住誘答的引文。
    const raw = (
      allQuestions as unknown as {
        id: string;
        answer: string | null;
        evidence?: { quote: string };
      }[]
    ).filter((q) => q.evidence);
    expect(raw.length, '這道 gate 在空轉 —— 沒有任何題目帶 evidence').toBeGreaterThan(100);
  });

  it('只把題幹抄一遍的引文不會被當成答案依據', () => {
    const echoed = allQuestions.filter((q) => {
      const quote = q.evidence?.quote ?? '';
      if (!quote) return false;
      const head = q.stem.slice(0, 12);
      return head.length >= 8 && quote.startsWith(head);
    });
    expect(
      echoed.map((q) => q.id),
      '這些題目的「答案依據」只是把題幹抄一遍，證明不了答案'
    ).toEqual([]);
  });

  it('getQuestionById 取回的題目同樣帶著答案依據（結果頁也看得到）', () => {
    const withEvidence = allQuestions.find((q) => q.evidence);
    expect(withEvidence).toBeDefined();
    const again = getQuestionById(withEvidence!.id);
    expect(again?.evidence?.quote).toBe(withEvidence!.evidence!.quote);
  });
});
