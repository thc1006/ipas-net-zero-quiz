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
import {
  PINNED_LAWS,
  resolveLaws,
  pcodeFromUrl,
  normalizeClauseKey,
  clauseKeys,
  clauseChineseForms,
  normalizeForCompare as norm,
  articleText,
  CLAUSE_PATTERN as CLAUSE,
} from '../utils/pinned-laws';

interface Evidence {
  quote?: string;
  url?: string;
  /**
   * 這則引文出自哪一條／段（例如 '第11條'、'§3'、'12-1'、'附錄C'）。
   *
   * 為什麼需要這個欄位：ISO／IFRS 這類付費或需登入的標準，網址裡沒有 `flno=` 之類
   * 可機器判讀的錨點，條文本身也不會寫自己的段號 —— 光有逐字引文，gate 無從得知
   * 「這則引文就是第 3 段」。唯一誠實的做法是把歸屬寫成資料，讓它可被審閱，
   * 而不是讓 gate 去猜（猜法已試過：用「引號前最近的條號」會被否定式引用騙）。
   *
   * 屬於釘住的法規時（網址帶 pcode），下方有一道 gate 會把宣告與釘選原文機器核對，
   * 所以宣告不可能在那個範圍內說謊。
   */
  clause?: string;
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

const ds = dataset as unknown as { gist_items: Item[]; our_unique_items: Item[] };
const pp = pool as unknown as { items: Item[] };
const ALL: Item[] = [...ds.gist_items, ...ds.our_unique_items, ...pp.items];
const who = (it: Item): string => it.item_id ?? it.id ?? `gist-${it.index}`;

const evidence = (it: Item): Evidence[] => [
  ...(it.metadata?.evidence ?? []),
  ...(it.provenance?.evidence ?? []),
];

/** 這一題在 `text` 裡指名的條號，有沒有任何一條真的被逐字依據綁住 */
function boundIn(it: Item, text: string): boolean {
  const keys = clauseKeys(text);
  if (keys.length === 0) return true;
  const evs = evidence(it);
  const quotes = evs.map((e) => norm(e.quote ?? '')).filter((q) => q.length >= 8);
  const urls = evs.map((e) => e.url ?? '');
  const laws = resolveLaws(`${it.stem} ${it.explanation ?? ''}`);
  const explQuotes = [...(it.explanation ?? '').matchAll(/「([^」]{12,})」/g)].map((m) =>
    norm(m[1])
  );

  return keys.some((key) => {
    // 1) 引文逐字落在釘住的那一條裡
    for (const code of laws) {
      const article = norm(articleText(code, key));
      if (!article) continue;
      if (quotes.some((q) => article.includes(q) || q.includes(article))) return true;
      if (explQuotes.some((q) => article.includes(q))) return true;
    }
    // 2) 引文 URL 直接指向該條
    if (urls.some((u) => new RegExp(`flno=${key}(?![0-9-])`).test(u))) return true;
    // 3) 條號本身出現在引文裡（阿拉伯數字、中文數字、或英文 Article N.N）
    const forms = [`§${key}`, `Article ${key}`, ...clauseChineseForms(key)];
    if (quotes.some((q) => forms.some((f) => q.includes(norm(f))))) return true;
    // 4) 引文 URL 的路徑本身就指名該條（unfccc 的 .../article-6/article-62）
    const slug = new RegExp(`article${key.replace(/[^0-9]/g, '')}(?![0-9])`);
    if (urls.some((u) => slug.test(u.toLowerCase().replace(/[^a-z0-9]/g, '')))) return true;
    // 5) 引文自己宣告它出自哪一條（見 Evidence.clause）
    if (evs.some((e) => e.clause && normalizeClauseKey(e.clause) === key)) return true;
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
  // 目前為空。`pool-aig-ifrs2026-003` 原本登記在此（理由：IFRS 全文 PDF 需登入），
  // 2026-09-27 撤回 —— 會計研究發展基金會公開了 IFRS S1／S2 正體中文版全文，
  // 段號與英文版一致，第 3、17、18 段都已逐字存為引文。結論下太快的一筆。
];

/**
 * 解析裡指名、但綁不住的條號。
 *
 * 這一群比題幹那一群更大 —— gate 第一版只看題幹，等於盲區比守備範圍還大。
 * 目前 28 題，多數是外部模擬題（vocus）隨題匯入的原作者解析，
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

  // 清冊現在是空的，這條目前必然通過；留著是為了下一次有人往清冊加東西時，
  // 修好之後不會忘記把它拿掉。
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

  it('清冊只准變少（現況 28 題）', () => {
    expect(EXPLANATION_UNBOUND.size).toBeLessThanOrEqual(28);
  });
});

describe('evidence[].clause 的宣告必須站得住', () => {
  const declared = ALL.flatMap((it) =>
    evidence(it)
      .filter((e) => e.clause)
      .map((e) => ({ id: who(it), e }))
  );

  const crossCheckable = declared.filter(({ e }) => {
    const code = pcodeFromUrl(e.url);
    return code !== null && PINNED_LAWS[code] !== undefined;
  });

  it('這條 gate 不能空轉：確實有引文宣告了 clause', () => {
    expect(declared.length).toBeGreaterThan(5);
  });

  // 下面那條交叉核對只對「網址帶 pcode 且屬釘住法規」的宣告生效。若有一天一則都不符，
  // 它會安靜地變成永遠通過 —— 那正是我在這個 repo 寫過的空轉 gate 的形狀。
  it('交叉核對本身不能空轉：至少要有數則宣告落在釘住的法規上', () => {
    expect(
      crossCheckable.length,
      '沒有任何 clause 宣告指向釘住的法規 —— 下面那條核對等於沒在跑'
    ).toBeGreaterThanOrEqual(5);
  });

  // 宣告是人寫的，所以凡是**機器查得到原文**的（釘住的法規，網址帶 pcode），
  // 就一定要核。ISO／IFRS 那類拿不到全文的只能靠人工審閱 —— 但那是因為真的驗不了，
  // 不是因為我們沒驗。
  it('宣告出自釘住法規某一條的引文，必須真的落在該條原文裡', () => {
    const bad: string[] = [];
    for (const { id, e } of crossCheckable) {
      const code = pcodeFromUrl(e.url) as string;
      const key = normalizeClauseKey(e.clause as string);
      const article = key ? norm(articleText(code, key)) : '';
      if (!article) {
        bad.push(`${id}: 宣告 clause=${e.clause}，但 ${code} 查無此條`);
        continue;
      }
      const q = norm(e.quote ?? '');
      if (q.length < 8) {
        bad.push(`${id}: 宣告 clause=${e.clause}，卻沒有足夠長度的引文`);
        continue;
      }
      if (!article.includes(q)) {
        bad.push(`${id}: 宣告出自 ${code} ${e.clause}，但引文不在該條原文裡`);
      }
    }
    expect(
      bad,
      'clause 宣告與釘選原文不符。宣告錯條號比沒有宣告更糟 —— 它會讓 gate 誤判為已綁住'
    ).toEqual([]);
  });

  // 這裡原本寫的是「宣告的 clause 必須真的被題幹或解析引用到」。它一跑就抓到四則，
  // 我看了輸出才發現**是規則錯、不是資料錯**：`tw_regs_44` 的 §4／§5／§10 引文是用來
  // 撐住答案的三個並列要件，題幹只指名 §37 —— 那些宣告是有用的溯源資訊，而且不會讓任何
  // 條號誤綁（沒被引用到的 key 根本不參與 boundIn 的比對）。規則保護不到任何東西，
  // 只是在阻止人寫下有用的註記，所以換掉。
  it('宣告 clause 的引文必須是完整可追溯的一則（有夠長的引文與 https 來源）', () => {
    const bad = declared
      .filter(({ e }) => norm(e.quote ?? '').length < 8 || !/^https:\/\//.test(e.url ?? ''))
      .map(({ id, e }) => `${id}: clause=${e.clause} 的引文或來源不完整`);
    expect(
      bad,
      'clause 是人工宣告的歸屬，唯一能自動守住的就是「它得掛在一則真的引文上」'
    ).toEqual([]);
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
