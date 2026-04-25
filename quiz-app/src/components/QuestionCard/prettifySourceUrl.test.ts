// prettifySourceUrl 單元測試
import { describe, it, expect } from 'vitest';
import { prettifySourceUrl } from './QuestionCard';

describe('prettifySourceUrl', () => {
  it('law.moj 全條與單條', () => {
    expect(
      prettifySourceUrl('https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=O0020098')
    ).toBe('氣候變遷因應法');
    expect(
      prettifySourceUrl('https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=O0020098&flno=56')
    ).toBe('氣候變遷因應法 §56');
  });

  it('EUR-Lex CELEX strips leading zeros', () => {
    expect(
      prettifySourceUrl('https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32023R0956')
    ).toBe('EU Reg 2023/956');
    expect(
      prettifySourceUrl('https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32025R2083')
    ).toBe('EU Reg 2025/2083');
  });

  it('GitHub path differentiation', () => {
    expect(
      prettifySourceUrl('https://github.com/thc1006/ipas-net-zero-quiz/discussions/1')
    ).toBe('GitHub Discussion');
    expect(
      prettifySourceUrl('https://github.com/thc1006/ipas-net-zero-quiz/issues/42')
    ).toBe('GitHub Issue');
    expect(
      prettifySourceUrl('https://github.com/thc1006/ipas-net-zero-quiz/pull/3')
    ).toBe('GitHub PR');
    expect(prettifySourceUrl('https://github.com/thc1006/ipas-net-zero-quiz')).toBe(
      'GitHub'
    );
  });

  it('known agency hosts', () => {
    expect(prettifySourceUrl('https://www.ipcc.ch/report/ar5/wg1/')).toBe('IPCC');
    expect(prettifySourceUrl('https://www.iso.org/standard/66453.html')).toBe('ISO');
    expect(prettifySourceUrl('https://www.cca.gov.tw/')).toBe('環境部 氣候變遷署');
    expect(prettifySourceUrl('https://www.cdp.net/en')).toBe('CDP');
  });

  it('unknown host falls back to bare host', () => {
    expect(prettifySourceUrl('https://www.example.com/foo')).toBe('example.com');
  });

  it('malformed URL returns original string', () => {
    expect(prettifySourceUrl('not a url')).toBe('not a url');
  });
});
