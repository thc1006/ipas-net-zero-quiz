// 來源 URL → 可讀標籤。
//
// 原本住在 QuestionCard.tsx。抽出來的原因：AnswerEvidence 也要用，
// 若讓它反過來 import QuestionCard，就會形成 QuestionCard ↔ AnswerEvidence 的循環相依
// （打包器多半吃得下去，但那是靠 hoisting 的運氣，而且會讓 ResultPage 連帶拉進 QuestionCard）。
import { LAW_PCODE_LABELS } from '../data/law-pcode-labels';

// host 是否等於 domain 或為其子網域（subdomain-boundary safe）。
// 取代 host.includes(domain) — 後者會把 'iso.org.evil.com' 誤判為 iso.org。
// CodeQL: js/incomplete-url-substring-sanitization
function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith('.' + domain);
}

/** 將 URL 轉成短而可讀的標籤；export 供測試使用 */
export function prettifySourceUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (hostMatches(host, 'law.moj.gov.tw')) {
      const pcode = u.searchParams.get('pcode');
      const flno = u.searchParams.get('flno');
      const name = pcode && LAW_PCODE_LABELS[pcode] ? LAW_PCODE_LABELS[pcode] : '法規';
      return flno ? `${name} §${flno}` : name;
    }
    if (hostMatches(host, 'eur-lex.europa.eu')) {
      const celex = u.searchParams.get('uri') || '';
      // CELEX 格式：3{year}R{number}，第一碼 3=legal acts；strip leading zeros from number
      const m = celex.match(/3(\d{4})R(\d+)/);
      if (m) {
        const year = m[1];
        const num = m[2].replace(/^0+/, '') || '0';
        return `EU Reg ${year}/${num}`;
      }
      return 'EUR-Lex';
    }
    if (hostMatches(host, 'ipcc.ch')) return 'IPCC';
    if (hostMatches(host, 'iso.org')) return 'ISO';
    if (hostMatches(host, 'cca.gov.tw')) return '環境部 氣候變遷署';
    if (hostMatches(host, 'moenv.gov.tw')) return '環境部';
    if (hostMatches(host, 'greentrade.org.tw')) return '綠色貿易資訊網';
    if (hostMatches(host, 'cdp.net')) return 'CDP';
    if (hostMatches(host, 'vocus.cc')) return 'vocus 文章';
    if (hostMatches(host, 'github.com')) {
      // 細分 path：discussions / issues / pulls / 其他
      // pathname 為 URL parser 解析後的欄位，不受 host-substring 攻擊影響
      if (u.pathname.includes('/discussions/')) return 'GitHub Discussion';
      if (u.pathname.includes('/issues/')) return 'GitHub Issue';
      if (u.pathname.includes('/pull/')) return 'GitHub PR';
      return 'GitHub';
    }
    return host.replace(/^www\./, '');
  } catch {
    return url;
  }
}
