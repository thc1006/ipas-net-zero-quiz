// 釘住法規的單一入口：別名、條號正規化、條文查詢。
//
// 為什麼要有這支 —— 這三件事先前在 law-quote-integrity.test.ts 與 clause-citation.test.ts
// 各寫了一份。前者的註解自己就寫著「兩份清單一定會漂，在這個 repo 已經應驗過三次」，
// 然後它就成了第四次。
//
// **換題庫的人要換的是資料，不是測試碼**：法規清單與別名放在
// tools/pin_law_articles.py 的 LAWS／ALIASES，重新產生 law-articles.pinned.json 後，
// 這裡與兩道 gate 都自動跟著換。所以別名一律從釘選檔讀，不在這裡硬寫。

import pinnedRaw from '../data/law-articles.pinned.json';

export interface PinnedLaw {
  name: string;
  url: string;
  article_count: number;
  sha256: string;
  /** 題目裡可能出現的簡稱（由 tools/pin_law_articles.py 的 ALIASES 提供） */
  aliases?: string[];
  articles: Record<string, string>;
}

export const PINNED_LAWS: Record<string, PinnedLaw> = (
  pinnedRaw as { laws: Record<string, PinnedLaw> }
).laws;

/**
 * [法規名稱或別名, pcode]，由釘選檔衍生。
 * 長名排前面：否則「氣候法」會先命中而蓋掉「氣候變遷因應法」。
 */
export const LAW_NAME_TO_CODE: ReadonlyArray<readonly [string, string]> = Object.entries(
  PINNED_LAWS
)
  .flatMap(([code, law]) => [law.name, ...(law.aliases ?? [])].map((n) => [n, code] as const))
  .sort((a, b) => b[0].length - a[0].length);

/** 這段文字提到了哪些釘住的法規（回 pcode，去重） */
export function resolveLaws(text: string): string[] {
  return [...new Set(LAW_NAME_TO_CODE.filter(([n]) => text.includes(n)).map(([, c]) => c))];
}

/** 網址裡的 pcode（全國法規資料庫）；沒有就回 null */
export function pcodeFromUrl(url: string | undefined): string | null {
  const m = /[?&]pcode=([A-Za-z0-9]+)/.exec(url ?? '');
  return m ? m[1] : null;
}

const CN = '零一二三四五六七八九';

/** 中文數字轉阿拉伯（只需支援條號範圍：1–99） */
export function cnToArabic(t: string): string {
  const s = t.trim();
  if (/^[0-9]+$/.test(s)) return String(Number(s));
  const m = /^([一二三四五六七八九]?)十([一二三四五六七八九]?)$/.exec(s);
  if (m) return String((m[1] ? CN.indexOf(m[1]) * 10 : 10) + (m[2] ? CN.indexOf(m[2]) : 0));
  const i = CN.indexOf(s);
  return i >= 0 ? String(i) : s;
}

/** 條號的中文與阿拉伯寫法（給「引文裡是否出現該條號」用） */
function cnNumeral(n: number): string | null {
  if (!Number.isInteger(n) || n < 1 || n > 99) return null;
  const d = (x: number): string => CN[x];
  return n < 10
    ? d(n)
    : n === 10
      ? '十'
      : n < 20
        ? `十${d(n % 10)}`
        : `${d(Math.floor(n / 10))}十${n % 10 ? d(n % 10) : ''}`;
}

export function clauseChineseForms(key: string): string[] {
  // 「之N」型條號（12-1 → 第十二條之一）。原本只處理純整數，於是 `ind-004` 的
  // 「第十條之一」明明逐字寫在引文裡卻綁不上 —— 是這支 helper 漏了，不是資料缺依據。
  const sub = /^([0-9]+)-([0-9]+)$/.exec(key);
  if (sub) {
    const a = cnNumeral(Number(sub[1]));
    const b = cnNumeral(Number(sub[2]));
    if (!a || !b) return [];
    return [`第${a}條之${b}`, `第${sub[1]}條之${sub[2]}`, `第${a}條之${sub[2]}`];
  }
  const zh = cnNumeral(Number(key));
  return zh ? [`第${zh}條`, `第${Number(key)}條`] : [];
}

/** 條號樣式：§6.4 / 第 7 條 / 第十二條之一 / ¶17 / Article 6.2 / Annex III */
export const CLAUSE_PATTERN =
  /§\s*\d[\d.-]*|第\s*(?:[0-9]+|[一二三四五六七八九十]+)\s*條(?:\s*之\s*(?:[0-9]+|[一二三四五六七八九十]+))?|¶\s*\d|Article\s*\d+(?:\.\d+)*|Annex\s+[IVX]/;

/** 單一條號字串正規化成比對用 key：'第十二條之一' → '12-1'、'§6.4' → '6.4' */
export function normalizeClauseKey(raw: string): string | null {
  const zh = /第\s*([0-9]+|[一二三四五六七八九十]+)\s*條(?:\s*之\s*([0-9]+|[一二三四五六七八九十]+))?/.exec(
    raw
  );
  if (zh) return cnToArabic(zh[1]) + (zh[2] ? `-${cnToArabic(zh[2])}` : '');
  // 帶字母前綴的段號（IFRS 的 B58、C3）—— 字母要保留。
  // 若剝成 '3'，宣告 clause:'C3' 就會誤綁到某部法規的「第 3 條」。
  const alpha = /^\s*([A-Za-z])\s*([0-9]+)\s*$/.exec(raw);
  if (alpha) return `${alpha[1].toUpperCase()}${alpha[2]}`;
  const num = /([0-9][0-9.-]*)/.exec(raw);
  return num ? num[1].replace(/[.-]+$/, '') : null;
}

/** 一段文字裡所有條號 key（去重） */
export function clauseKeys(text: string): string[] {
  const g = new RegExp(CLAUSE_PATTERN.source, 'g');
  const out: string[] = [];
  for (const raw of text.match(g) ?? []) {
    const k = normalizeClauseKey(raw);
    if (k) out.push(k);
  }
  return [...new Set(out)];
}

/** 比對用正規化：去標點與空白（法規頁的換行與全形標點會隨版面變動） */
export function normalizeForCompare(t: string): string {
  return (t ?? '')
    .normalize('NFKC')
    .replace(/[\s\u3000，。、：；「」『』（）()【】[\]\-–—/.]+/g, '');
}

/** 某部釘住法規的某一條原文（找不到回空字串） */
export function articleText(code: string, key: string): string {
  return PINNED_LAWS[code]?.articles?.[key] ?? '';
}
