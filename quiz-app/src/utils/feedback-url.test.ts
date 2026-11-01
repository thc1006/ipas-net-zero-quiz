import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '../data/app-meta';
import {
  buildBugReportUrl,
  buildFeedbackUrl,
  DISCUSSIONS_URL,
  ERROR_MAX_CHARS,
  REPORT_URL,
} from './feedback-url';

const REPO = 'https://github.com/thc1006/ipas-net-zero-quiz';

describe('回報問題與討論區的網址', () => {
  it('回報問題是開新 issue 的範本選單，討論區是 Discussions', () => {
    expect(REPORT_URL).toBe(`${REPO}/issues/new/choose`);
    expect(DISCUSSIONS_URL).toBe(`${REPO}/discussions`);
  });
});

describe('buildBugReportUrl：網站問題範本', () => {
  const params = (url: string) => new URL(url).searchParams;

  it('指向網站問題範本，帶入網站版本；沒有錯誤訊息就不帶 error_message', () => {
    const url = buildBugReportUrl();
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(`${REPO}/issues/new`);
    expect([...u.searchParams.keys()]).toEqual(['template', 'app_version']);
    expect(u.searchParams.get('template')).toBe('site-bug.yml');
    expect(u.searchParams.get('app_version')).toBe(APP_VERSION);
  });

  it('只帶錯誤訊息的第一行，前後空白去掉，不帶堆疊', () => {
    const message = '  Cannot read properties of undefined (reading \'stem\')  \n    at QuestionCard (QuestionCard.tsx:42:7)\r\n    at div';
    expect(params(buildBugReportUrl({ errorMessage: message })).get('error_message')).toBe(
      "Cannot read properties of undefined (reading 'stem')"
    );
    expect(params(buildBugReportUrl({ errorMessage: 'first\rsecond' })).get('error_message')).toBe('first');
    // 開頭是空行時取第一個有字的行
    expect(params(buildBugReportUrl({ errorMessage: '\n\n  boom\nstack' })).get('error_message')).toBe('boom');
  });

  it('空的、只有空白或不是字串的錯誤訊息不帶 error_message', () => {
    // throw 的不一定是 Error：message 可能是數字、物件或 null
    for (const errorMessage of ['', '   ', '\n\t\n', undefined, null, 42, { toString: () => 'x' }, ['a']]) {
      expect(params(buildBugReportUrl({ errorMessage })).has('error_message'), JSON.stringify(errorMessage)).toBe(false);
    }
  });

  it(`錯誤訊息超過 ${ERROR_MAX_CHARS} 個字截斷並加省略號，剛好 ${ERROR_MAX_CHARS} 個字不截`, () => {
    const exact = 'E'.repeat(ERROR_MAX_CHARS);
    expect(params(buildBugReportUrl({ errorMessage: exact })).get('error_message')).toBe(exact);
    const long = params(buildBugReportUrl({ errorMessage: 'E'.repeat(ERROR_MAX_CHARS + 1) })).get('error_message')!;
    expect(long).toBe(`${exact}…`);
  });

  it('以字（code point）計算長度：BMP 以外的字不會被切成半個', () => {
    // U+20000 是 CJK 擴充 B 的字，UTF-16 是兩個 code unit
    const wide = String.fromCodePoint(0x20000);
    const got = params(buildBugReportUrl({ errorMessage: wide.repeat(ERROR_MAX_CHARS + 5) })).get('error_message')!;
    expect(got).toBe(`${wide.repeat(ERROR_MAX_CHARS)}…`);
    expect(got).not.toContain('\uFFFD');
  });

  it('網址長度有上限：最長的錯誤訊息、每個字都要 4 個位元組時，整個網址也不超過 4096 個字元', () => {
    // GitHub 沒有公布上限，超過會回 414 URI Too Long；常見伺服器的請求行上限是 8 KB，這裡留一半
    const url = buildBugReportUrl({ errorMessage: String.fromCodePoint(0x20000).repeat(10_000) });
    expect(url.length).toBeLessThanOrEqual(4096);
  });

  it('特殊字元（&、=、#、+、中文）正確 percent-encode，還原後是原字串', () => {
    const message = 'a&b=c#d+e 錯誤?';
    const url = buildBugReportUrl({ errorMessage: message });
    expect(params(url).get('error_message')).toBe(message);
    expect(url).not.toContain('#');
    expect(url).toMatch(/error_message=a%26b%3Dc%23d%2Be\+%E9%8C%AF%E8%AA%A4%3F$/);
  });
});

describe('buildFeedbackUrl (#63)', () => {
  it('產生指向 issues/new 的 URL 並帶 template + q_id + q_stem + from_page', () => {
    const url = buildFeedbackUrl({
      questionId: 'gist-334',
      stem: 'ISSB S1 描述何者錯誤？',
      fromPage: 'quiz',
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(
      'https://github.com/thc1006/ipas-net-zero-quiz/issues/new'
    );
    expect(u.searchParams.get('template')).toBe('question-feedback.yml');
    expect(u.searchParams.get('q_id')).toBe('gist-334');
    expect(u.searchParams.get('q_stem')).toBe('ISSB S1 描述何者錯誤？');
    expect(u.searchParams.get('from_page')).toBe('quiz');
  });

  it('題幹超過 100 字會截斷並加省略號', () => {
    const longStem = 'A'.repeat(150);
    const url = buildFeedbackUrl({
      questionId: 'q-1',
      stem: longStem,
      fromPage: 'result',
    });
    const stem = new URL(url).searchParams.get('q_stem')!;
    expect(stem.length).toBe(101); // 100 + '…'
    expect(stem.endsWith('…')).toBe(true);
    expect(stem.startsWith('A'.repeat(100))).toBe(true);
  });

  it('題幹剛好 100 字不截斷不加省略號', () => {
    const exactStem = 'A'.repeat(100);
    const url = buildFeedbackUrl({
      questionId: 'q-1',
      stem: exactStem,
      fromPage: 'quiz',
    });
    const stem = new URL(url).searchParams.get('q_stem')!;
    expect(stem).toBe(exactStem);
    expect(stem.endsWith('…')).toBe(false);
  });

  it('題幹裡的換行也編碼：網址裡沒有空白字元，還原後是原字串', () => {
    // 網址裡的換行字元會被 URL 解析直接刪掉，兩行會黏成一行
    const url = buildFeedbackUrl({ questionId: 'q-1', stem: '第一行\r\n第二行\t表格', fromPage: 'quiz' });
    expect(url).not.toMatch(/\s/);
    expect(new URL(url).searchParams.get('q_stem')).toBe('第一行\r\n第二行\t表格');
  });

  it('題幹前後空白會 trim', () => {
    const url = buildFeedbackUrl({
      questionId: 'q-1',
      stem: '  題目開頭  ',
      fromPage: 'quiz',
    });
    expect(new URL(url).searchParams.get('q_stem')).toBe('題目開頭');
  });

  it('特殊字元（中文、&、=）正確 percent-encode', () => {
    const url = buildFeedbackUrl({
      questionId: 'p&q=1',
      stem: '依 IFRS S2 §15(a)',
      fromPage: 'result',
    });
    const u = new URL(url);
    // URLSearchParams 會自動正確 encode；URL 還原時 get() 回原值
    expect(u.searchParams.get('q_id')).toBe('p&q=1');
    expect(u.searchParams.get('q_stem')).toBe('依 IFRS S2 §15(a)');
    // 確認 raw URL 有 percent-encoding 而非裸字元
    expect(url).toMatch(/q_id=p%26q%3D1/);
  });
});
