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

  // CodeQL js/incomplete-url-substring-sanitization regression：
  // host.includes(domain) 會把 'iso.org.evil.com' 誤判為 iso.org；
  // hostMatches 用 endsWith('.' + domain) 強制 subdomain 邊界。
  describe('subdomain-boundary safety (CodeQL regression)', () => {
    it('host suffix attack 不應誤標：iso.org.attacker.com → fallback', () => {
      expect(prettifySourceUrl('https://iso.org.attacker.com/path')).toBe('iso.org.attacker.com');
      expect(prettifySourceUrl('https://github.com.evil.example/foo')).toBe('github.com.evil.example');
      expect(prettifySourceUrl('https://cdp.net.phisher.io/x')).toBe('cdp.net.phisher.io');
    });
    it('host prefix attack 不應誤標：xiso.org → fallback', () => {
      expect(prettifySourceUrl('https://xiso.org/foo')).toBe('xiso.org');
      // siso.org 不該被當 iso.org
      expect(prettifySourceUrl('https://siso.org/bar')).toBe('siso.org');
    });
    it('path 含 known-host 字串不應誤標：evil.com/iso.org/path → fallback', () => {
      // URL parser 把 path 跟 host 分開，host 是 evil.example，不會 match
      expect(prettifySourceUrl('https://evil.example/iso.org/standard')).toBe('evil.example');
    });
    it('合法 subdomain 仍應命中：www.iso.org → ISO、a.b.iso.org → ISO', () => {
      expect(prettifySourceUrl('https://www.iso.org/standard/12345.html')).toBe('ISO');
      expect(prettifySourceUrl('https://committees.iso.org/foo')).toBe('ISO');
    });
  });
});
