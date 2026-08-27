// 題幹指名條號，就必須拿得出**那一條**的逐字依據。
//
// 起因：`pool-em-ipas_vocus_mock-054` 的題幹寫「依 ISO 14064-1:2018 §6.4」，但整題沒有任何
// 逐字引文能釘住該條號 —— 考生會把一個沒人查證過的條號背起來。ISO／IFRS 是付費或第三方版權
// 文件，不能由二手教材推定條號。
//
// 第一版只檢查「這題有沒有任何引文」，複審指出那擋不住真正的問題：
// 題幹寫 §6.4、引文是別條，照樣過關。而且它讀的是 `metadata.evidence` ——
// **練習池的引文放在 `provenance.evidence`**，所以對池題那個檢查永遠是空的，
// 全靠解析裡剛好有「」才沒破。等於守了一半，還不知道守了哪一半。
//
// 現在要求「綁得住」，三條路徑（都不是啟發式，都能指出是哪一條）：
//   1. 引文逐字落在**釘住的那部法的那一條**裡（law-articles.pinned.json，sha256 監控）；
//   2. 引文的 URL 明確指向該條（law.moj.gov.tw 的 `flno=`）；
//   3. 條號本身出現在引文裡（阿拉伯數字、中文數字或英文 Article N.N）——
//      例如答案卡引文寫著「巴黎協定第二條所列的目標」；
//   4. 引文 URL 的路徑本身指名該條（unfccc 的 .../article-6/article-62）——
//      那是站方自己的編排，不是我們推定的。
//
// 刻意**不用**「引號前最近的條號」這種推定：law-quote-integrity 試過，
// 會被解析裡的否定式引用騙（「§3（非 §4）規定…」被判成 §4）。
// 綁不住就是綁不住 —— 補一手引文，或把條號改成敘述性引述（概念不變、不必背一個沒人查證過的條號）。
import { describe, it, expect } from 'vitest';
import dataset from './integrated_dataset.json';
import pool from './practice_pool.json';
import pinnedRaw from './law-articles.pinned.json';

interface Evidence {
  quote?: string;
  url?: string;
}
interface Item {
  index?: number;
  item_id?: string;
  id?: string;
  stem: string;
  explanation?: string | null;
  metadata?: { evidence?: Evidence[] };
  /** 練習池的引文放這裡，不是 metadata —— 第一版漏了這個 */
  provenance?: { evidence?: Evidence[] };
}
interface PinnedLaw {
  articles: Record<string, string>;
}

const PINNED = (pinnedRaw as { laws: Record<string, PinnedLaw> }).laws;

/** 題目裡怎麼稱呼這部法，都要能對到同一個 pcode（與 law-quote-integrity 同一份對照） */
const ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['氣候變遷因應法', 'O0020098'],
  ['氣候法', 'O0020098'],
  ['溫室氣體排放量盤查登錄及查驗管理辦法', 'O0020102'],
  ['溫管辦法', 'O0020102'],
  ['碳費收費辦法', 'O0020139'],
  ['溫室氣體自願減量專案管理辦法', 'O0020137'],
  ['自主減量計畫管理辦法', 'O0020140'],
  ['再生能源發展條例', 'J0130032'],
];

// §6.4 / 第 7 條 / 第十二條之一 / ¶17 / Article 6 / Annex III
const CLAUSE =
  /§\s*\d[\d.-]*|第\s*(?:[0-9]+|[一二三四五六七八九十]+)\s*條(?:\s*之\s*(?:[0-9]+|[一二三四五六七八九十]+))?|¶\s*\d|Article\s*\d+(?:\.\d+)*|Annex\s+[IVX]/;
const CLAUSE_G = new RegExp(CLAUSE.source, 'g');

const CN = '零一二三四五六七八九';
function cnToArabic(t: string): string {
  if (/^[0-9]+$/.test(t)) return String(Number(t));
  const m = /^([一二三四五六七八九]?)十([一二三四五六七八九]?)$/.exec(t);
  if (m) return String((m[1] ? CN.indexOf(m[1]) * 10 : 10) + (m[2] ? CN.indexOf(m[2]) : 0));
  const i = CN.indexOf(t);
  return i >= 0 ? String(i) : t;
}

/** 把題幹裡的條號整理成可比對的 key：'21'、'12-1'、'6.4'（ISO 等） */
function clauseKeys(stem: string): string[] {
  const out: string[] = [];
  for (const raw of stem.match(CLAUSE_G) ?? []) {
    const zh = /第\s*([0-9]+|[一二三四五六七八九十]+)\s*條(?:\s*之\s*([0-9]+|[一二三四五六七八九十]+))?/.exec(raw);
    if (zh) {
      out.push(cnToArabic(zh[1]) + (zh[2] ? `-${cnToArabic(zh[2])}` : ''));
      continue;
    }
    const num = /([0-9][0-9.-]*)/.exec(raw);
    if (num) out.push(num[1].replace(/[.-]+$/, ''));
  }
  return [...new Set(out)];
}

/** 比對用正規化：去掉標點與空白（法規頁的換行與全形標點會隨版面變動） */
const norm = (t: string): string =>
  (t ?? '').normalize('NFKC').replace(/[\s\u3000，。、：；「」（）()【】[\]\-–—/.]+/g, '');

const evidence = (it: Item): Evidence[] => [
  ...(it.metadata?.evidence ?? []),
  ...(it.provenance?.evidence ?? []),
];

/** 條號的中文寫法（給路徑 3 用：引文可能寫「第二條」而題幹寫「第 2 條」） */
function cnForms(key: string): string[] {
  const n = Number(key);
  if (!Number.isInteger(n) || n < 1 || n > 99) return [];
  const d = (x: number): string => CN[x];
  const zh =
    n < 10 ? d(n) : n === 10 ? '十' : n < 20 ? `十${d(n % 10)}` : `${d(Math.floor(n / 10))}十${n % 10 ? d(n % 10) : ''}`;
  return [`第${zh}條`, `第${n}條`];
}

const ds = dataset as unknown as { gist_items: Item[]; our_unique_items: Item[] };
const pp = pool as unknown as { items: Item[] };
const ALL: Item[] = [...ds.gist_items, ...ds.our_unique_items, ...pp.items];
const who = (it: Item): string => it.item_id ?? it.id ?? `gist-${it.index}`;

/** 這一題在 `text` 裡指名的條號，有沒有任何一條真的被逐字依據綁住 */
function boundIn(it: Item, text: string): boolean {
  const keys = clauseKeys(text);
  if (keys.length === 0) return true;
  const evs = evidence(it);
  const quotes = evs.map((e) => norm(e.quote ?? '')).filter((q) => q.length >= 8);
  const urls = evs.map((e) => e.url ?? '');
  const whole = `${it.stem} ${it.explanation ?? ''}`;
  const laws = ALIASES.filter(([name]) => whole.includes(name)).map(([, code]) => code);
  const explQuotes = [...(it.explanation ?? '').matchAll(/「([^」]{12,})」/g)].map((m) => norm(m[1]));

  return keys.some((key) => {
    // 1) 引文逐字落在釘住的那一條裡
    for (const code of laws) {
      const article = norm(PINNED[code]?.articles?.[key] ?? '');
      if (!article) continue;
      if (quotes.some((q) => article.includes(q) || q.includes(article))) return true;
      if (explQuotes.some((q) => article.includes(q))) return true;
    }
    // 2) 引文 URL 直接指向該條
    if (urls.some((u) => new RegExp(`flno=${key}(?![0-9-])`).test(u))) return true;
    // 3) 條號本身出現在引文裡（阿拉伯數字、中文數字、或英文 Article N.N）
    const forms = [`§${key}`, `Article ${key}`, ...cnForms(key)];
    if (quotes.some((q) => forms.some((f) => q.includes(norm(f))))) return true;
    // 4) 引文 URL 的路徑本身就指名該條（unfccc 的 .../article-6/article-62、
    //    .../article-64-mechanism）—— 路徑是站方自己的編排，不是我們推定的
    const slug = new RegExp(`article${key.replace(/[^0-9]/g, '')}(?![0-9])`);
    if (urls.some((u) => slug.test(u.toLowerCase().replace(/[^a-z0-9]/g, '')))) return true;
    return false;
  });
}

/**
 * 綁不住、但**已明確登記**的條號引用。
 *
 * 為什麼要有這份清冊，而不是把條號刪掉了事 —— 這是我自己踩過的坑：
 * 我一度把 `ifrs2026-003`、`ind-004`、`intl-025` 的條號從**題幹**拿掉讓這道 gate 轉綠，
 * 但**解析裡原封不動留著同樣的條號**。可驗證性一點沒變，只是 gate 看不到 ——
 * 那是在鑽自己設的洞。回頭查證後，`ind-004` 的三個條號其實逐字寫在金管會預告新聞稿的標題裡
 * （該補的是引文，不是刪題幹），`intl-025` 的 UNFCCC 網址路徑本來就綁得住。
 * 真正綁不住的只剩下面這些，明列出來、只准變少。
 */
const STEM_UNBOUND: ReadonlyArray<{ id: string; why: string }> = [
  {
    id: 'pool-aig-ifrs2026-003',
    why: 'IFRS S1 全文 PDF 在 ifrs.org 需登入（實測 302 轉向 b2clogin），段號無法由免費一手來源逐字釘住。解析本身是一則有價值的更正註記（說明該英文原文出自第 3 段而非第 17 段），不刪。',
  },
];

/**
 * 解析裡指名、但綁不住的條號。
 *
 * 這一群比題幹那一群更大 —— gate 第一版只看題幹，等於盲區比守備範圍還大。
 * 目前 29 題，多數是外部模擬題（vocus）隨題匯入的原作者解析，
 * 以及付費標準（ISO／IFRS）的段號。**這份清冊只准變少**：
 * 新出現而不在清冊裡的，一律轉紅。
 */
const EXPLANATION_UNBOUND: ReadonlySet<string> = new Set([
  'S_VOCUS_02-q010',
  'gist-29',
  'gist-46',
  'gist-83',
  'gist-179',
  'gist-255',
  'gist-312',
  'gist-314',
  'gist-408',
  // 題幹也綁不住（見 STEM_UNBOUND）：IFRS 段號無免費一手來源
  'pool-aig-ifrs2026-003',
  'pool-aig-ind-010',
  'pool-aig-intl-007',
  'pool-aig-intl-019',
  'pool-aig-tw_regs_01-v2',
  'pool-em-ipas_vocus_mock-001',
  'pool-em-ipas_vocus_mock-002',
  'pool-em-ipas_vocus_mock-011',
  'pool-em-ipas_vocus_mock-014',
  'pool-em-ipas_vocus_mock-015',
  'pool-em-ipas_vocus_mock-025',
  'pool-em-ipas_vocus_mock-026',
  'pool-em-ipas_vocus_mock-028',
  'pool-em-ipas_vocus_mock-044',
  'pool-em-ipas_vocus_mock-046',
  'pool-em-ipas_vocus_mock-047',
  'pool-em-ipas_vocus_mock-049',
  'pool-em-ipas_vocus_mock-054',
  'pool-em-ipas_vocus_mock-055',
  'pool-em-ipas_vocus_mock_rescued-050',
]);

describe('題幹指名條號者，必須綁得住那一條的逐字依據', () => {
  const cited = ALL.filter((it) => CLAUSE.test(it.stem));

  it('這條 gate 不能空轉：題庫裡確實有指名條號的題目', () => {
    expect(cited.length).toBeGreaterThan(20);
  });

  it('每一題指名的條號，都要能綁到該條的逐字依據（除已登記者）', () => {
    const ledger = new Set(STEM_UNBOUND.map((x) => x.id));
    const unbound = cited
      .filter((it) => !boundIn(it, it.stem))
      .filter((it) => !ledger.has(who(it)))
      .map((it) => `${who(it)}〔${clauseKeys(it.stem).join('、')}〕: ${it.stem.slice(0, 40)}`);
    expect(
      unbound,
      '這些題目在題幹指名了條號，卻沒有任何逐字依據綁得住那一條。' +
        '請補該條的一手引文，或（若真的無法逐字釘住）登記進 STEM_UNBOUND 並寫明理由'
    ).toEqual([]);
  });

  it('登記在清冊裡的，必須真的還綁不住（修好了就要從清冊移除）', () => {
    const stale = STEM_UNBOUND.filter((x) => {
      const it = ALL.find((q) => who(q) === x.id);
      return it && boundIn(it, it.stem);
    }).map((x) => x.id);
    expect(stale, '這些已經綁得住了，請把它們從 STEM_UNBOUND 拿掉').toEqual([]);
  });
});

describe('解析裡指名的條號，同樣要綁得住', () => {
  // 只看「題幹沒指名、但解析指名」的那一群 —— 題幹那一群由上面那組守。
  const cited = ALL.filter((it) => CLAUSE.test(it.explanation ?? ''));

  it('這條 gate 不能空轉：確實有解析在指名條號', () => {
    expect(cited.length).toBeGreaterThan(30);
  });

  it('解析指名的條號綁不住時，必須已登記在清冊裡', () => {
    const unbound = cited
      .filter((it) => !boundIn(it, it.explanation ?? ''))
      .map(who)
      .filter((id) => !EXPLANATION_UNBOUND.has(id));
    expect(
      unbound,
      '這些題目的**解析**指名了條號卻綁不住。' +
        '把條號從題幹搬到解析不算修好 —— 補一手引文，或登記進 EXPLANATION_UNBOUND'
    ).toEqual([]);
  });

  it('清冊只准變少（現況 29 題）', () => {
    expect(EXPLANATION_UNBOUND.size).toBeLessThanOrEqual(29);
  });
});

describe('gate 的資料來源本身', () => {
  it('練習池的引文放在 provenance.evidence —— 這條 gate 必須真的讀得到', () => {
    const poolWithEvidence = pp.items.filter((it) => (it.provenance?.evidence ?? []).length > 0);
    expect(
      poolWithEvidence.length,
      '池題的引文一則都讀不到 —— 十之八九又讀錯欄位了'
    ).toBeGreaterThan(50);
  });
});
