// 法條引文的逐字性
//
// 這道 gate 守的是一個**實際發生過、而且原本沒有任何東西看得到**的錯誤：
// 把模型生成的文字放進「」裡，當成法條原文呈現給使用者。
//
//   - pool-aig-tw_regs_38 宣稱氣候變遷因應法 §35 寫著
//     「應參酌國際公約決議事項，分階段公告納入總量管制之排放源、排放總量、核配方式、
//       保留及禁止移轉之事項」—— §35 全文裡**沒有這兩句**。
//
//   - pool-aig-tw_regs_45 宣稱氣候法 §60 的滯納金「至應納金額之百分之十五為限」
//     —— 條文**沒有任何上限明文**。而那一題的干擾選項正好寫著「合計 15%」，
//     捏造的上限剛好替錯的選項背書。
//
// 為什麼既有的檢查抓不到：季排程只驗「連結還通不通」。
// law.moj.gov.tw/…&flno=35 回 200，永遠是綠的 —— 它驗不出「我們寫的不是那條文說的話」。
//
// 規則（規則要能當 gate，就必須乾淨）：
//     「」+ 法規引用 ＝ 宣稱這是條文原文 → 必須逐字出現在該法規裡。
//     是意譯、是條文標題、是法規名稱 → **不要加引號**。
//
// 注意這裡刻意**不比對條號**。我試過用「引號前最近的條號」來判斷歸屬，
// 結果被解析裡的否定式引用騙了（「§3（非 §4）規定…」會被判成 §4）。
// 一個假陽性比資料還多的檢查器沒有價值 —— 所以只驗「這句話在不在這部法裡」，
// 不驗「在第幾條」。條號歸屬的錯誤靠人工審核與 DATA-PROVENANCE 的紀錄處理。
import { describe, it, expect } from 'vitest';
import pinnedRaw from './law-articles.pinned.json';
import datasetRaw from './integrated_dataset.json';
import poolRaw from './practice_pool.json';

interface PinnedLaw {
  name: string;
  url: string;
  article_count: number;
  sha256: string;
  articles: Record<string, string>;
}
const PINNED = (pinnedRaw as { laws: Record<string, PinnedLaw> }).laws;

/** 法規別名 -> pcode。題目裡怎麼稱呼它，都要能對到同一部法。 */
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

/**
 * 「這句話宣稱自己是法條原文」的判準：**長度 >= 16 字，且含全形逗號或分號。**
 *
 * 為什麼是這條看起來很笨的規則：
 *   法條是**長句**（一定有逗號／分號）；公告標題、制度標籤、法規名稱是**名詞片語**（沒有）。
 *
 * 我先試過「含應／得／處等規範性動詞」，被兩個真實案例打臉：
 *   - gist[150] 的「事業應盤查登錄及查驗溫室氣體排放量之排放源」是一份**環境部公告的標題**
 *     —— 中文的公告標題長得就像法條。
 *   - 氣候法 §60 前半段（「每逾一日按滯納之金額加徵百分之零點五滯納金」）**根本沒有這些動詞**
 *     —— 判準會漏掉真正該檢查的條文。
 *
 * 也試過「看引號前面是不是『公告』『為』來判斷是引用還是指稱」——
 * 那就是鄰近性啟發法，而這個檔案存在的理由之一就是我用它出過錯
 * （「§3（非 §4）規定…」會被判成 §4）。**判準寧可笨，不可聰明。**
 *
 * 代價（誠實說明）：**抓不到「沒有逗號的短捏造」**。
 * 可接受 —— 法條幾乎不可能是無標點的短句；短引文多半是術語或文件名稱。
 */
const CLAUSE_MARK = /[，；]/u;
const MIN_QUOTE_LEN = 16;

/** 逐字比對前的正規化：只去空白與標點，**不動數字、不動用字**。 */
const canon = (s: string) =>
  s.normalize('NFKC').replace(/[\s、，。；：（）()「」『』…．.,\-－—–~/]+/gu, '');

/** 條文原文全部串起來 —— 只問「這句話在不在這部法裡」，不問在第幾條。 */
const lawBody = (pcode: string) => canon(Object.values(PINNED[pcode].articles).join(''));
const BODY: Record<string, string> = Object.fromEntries(
  Object.keys(PINNED).map((p) => [p, lawBody(p)])
);

interface Quote {
  who: string;
  pcode: string;
  law: string;
  quote: string;
}

/** 找出一段文字裡「宣稱是法條原文」的引文。文字有引用哪部法，才算數。 */
function extractQuotes(who: string, text: string): Quote[] {
  const cited = ALIASES.filter(([name]) => text.includes(name)).map(([, p]) => p);
  if (cited.length === 0) return [];
  const out: Quote[] = [];
  for (const m of text.matchAll(/[「『]([^」』]+)[」』]/gu)) {
    const q = m[1];
    if (q.length < MIN_QUOTE_LEN) continue;
    if (!CLAUSE_MARK.test(q)) continue;
    // 引文若非中文為主（例如 IFRS 的英文原文），不是台灣法條，跳過
    const cjk = (q.match(/[一-鿿]/gu) ?? []).length;
    if (cjk < q.length * 0.5) continue;
    for (const pcode of new Set(cited)) {
      out.push({ who, pcode, law: PINNED[pcode].name, quote: q });
    }
  }
  return out;
}

/**
 * 引文是否逐字出現在該法裡。
 * 允許以刪節號、頓號、分號切段（引用時省略中間段落是正常的），
 * 但**每一段都必須是條文的子字串** —— 這樣「憑空多一句」就會被抓到。
 */
function isVerbatim(pcode: string, quote: string): boolean {
  const body = BODY[pcode];
  const frags = quote
    .split(/…+|\.{3}|、|；|;|——|--/u)
    .map(canon)
    .filter((f) => f.length >= 6);
  if (frags.length === 0) return canon(quote).length < 6 || body.includes(canon(quote));
  return frags.every((f) => body.includes(f));
}

// ── 題庫載入 ────────────────────────────────────────────────────────
interface BankItem {
  id?: string;
  index?: number;
  stem: string;
  explanation?: string;
}
const ds = datasetRaw as unknown as { gist_items: BankItem[]; our_unique_items: BankItem[] };
const MAIN = [...ds.gist_items, ...ds.our_unique_items];
const POOL = (poolRaw as unknown as { items: BankItem[] }).items;

const collect = (items: BankItem[], label: (i: BankItem) => string) =>
  items.flatMap((it) => extractQuotes(label(it), `${it.stem}。${it.explanation ?? ''}`));

const ALL_QUOTES = [
  ...collect(MAIN, (i) => i.id ?? `gist[${i.index}]`),
  ...collect(POOL, (i) => i.id!),
];

describe('法條引文必須逐字', () => {
  it('釘選檔本身是完整的（每部法都有條文與 sha256）', () => {
    for (const [pcode, law] of Object.entries(PINNED)) {
      expect(law.article_count, `${pcode} 沒有條文`).toBeGreaterThan(0);
      expect(Object.keys(law.articles).length).toBe(law.article_count);
      expect(law.sha256, `${pcode} 沒有 sha256`).toMatch(/^[0-9a-f]{64}$/);
      expect(BODY[pcode].length, `${pcode} 條文是空的`).toBeGreaterThan(200);
    }
  });

  it('這條測試不是空轉：題庫裡確實有宣稱是法條原文的引文', () => {
    expect(
      ALL_QUOTES.length,
      '一則法條引文都沒抓到 —— 判準壞了，這道 gate 等於不存在'
    ).toBeGreaterThan(5);
  });

  it('引號裡宣稱是法條原文的句子，必須逐字出現在所引用的法規中', () => {
    const bad = ALL_QUOTES.filter((q) => !isVerbatim(q.pcode, q.quote))
      // 一題可能同時引用多部法；只要有任一部對得上就算數（引文只可能出自其中一部）
      .filter(
        (q) =>
          !ALL_QUOTES.some(
            (o) => o.who === q.who && o.quote === q.quote && isVerbatim(o.pcode, o.quote)
          )
      )
      .map((q) => `${q.who}：宣稱是《${q.law}》的條文，但該法全文中查無此句\n      「${q.quote}」`);

    expect(
      [...new Set(bad)],
      '把模型生成的文字放進「」裡當成法條原文 —— 使用者會以為自己在讀法律。\n' +
        '若那只是意譯或條文標題，就不要加引號；若是引用，就必須逐字。'
    ).toEqual([]);
  });

  // 變異測試：把一句捏造的條文塞進去，這道 gate 必須變紅。
  // 「抓不到東西的 gate 沒有價值」—— 這條證明它真的有牙齒。
  it('（變異測試）捏造的條文一定會被擋下來', () => {
    const fake = extractQuotes(
      'MUTANT',
      '依《氣候變遷因應法》第 60 條規定：「每逾一日按滯納之金額加徵百分之零點五滯納金，' +
        '至應納金額之百分之十五為限；逾期三十日仍未繳納者，移送強制執行」。'
    );
    expect(fake.length, '變異樣本沒被判定為法條引文').toBeGreaterThan(0);
    expect(
      fake.some((q) => !isVerbatim(q.pcode, q.quote)),
      '「至應納金額之百分之十五為限」是捏造的（§60 無上限明文），但 gate 放行了'
    ).toBe(true);
  });

  it('（變異測試）真正的條文原文不會被誤殺', () => {
    const real = extractQuotes(
      'CONTROL',
      '依《氣候變遷因應法》第 60 條規定：「每逾一日按滯納之金額加徵百分之零點五滯納金，' +
        '一併繳納；逾期三十日仍未繳納者，移送強制執行」。'
    );
    expect(real.length).toBeGreaterThan(0);
    expect(
      real.every((q) => isVerbatim(q.pcode, q.quote)),
      '真的條文原文被判成捏造 —— 這道 gate 會製造假警報'
    ).toBe(true);
  });

  // ── 條號存在性 ──────────────────────────────────────────────────
  //
  // ⚠️ **先說清楚這道 gate 抓不到什麼，免得它變成一句假的保證。**
  //
  // 第五輪的解析稽核找到一個真實的缺陷類別：**條號錯位**。
  // 例如 `mock-008` 的解析寫「依《溫室氣體自願減量專案管理辦法》**第 6 條**，外加性指…」——
  // 但「外加性分析」的定義在**第 2 條第六款**；**§6 講的是聯合共同提案，全文查無「外加性」**。
  // 「第 2 條第**六款**」被寫成了「第 **6** 條」。
  //
  // **這道 gate 抓不到那個錯**，因為 §6 **是存在的**。
  //
  // 我試過三個機械規則想抓它，**三個都不合格**：
  //   A. 條號必須存在        → 零假陽性，但抓不到 mock-008（§6 存在）
  //   B. 條號緊鄰的「」引文須在該條 → 假陽性：引號裡常是**文件名稱**而非法條原文
  //   C. 條號後的實質詞須出現在該條 → 假陽性一片，因為解析常寫**對比式／否定式**引用：
  //      「§8 為發電業電力消費排放量證明扣除（**不是本題**）」
  //      「§36 規範的是核配額度**與財務揭露無關**」
  //      —— 這正是這個檔案開頭那段註解早就警告過的坑（「§3（非 §4）規定…」會被判成 §4）。
  //      **一個假陽性比真陽性還多的檢查器沒有價值。**
  //
  // 所以：**條號歸屬的正確性目前沒有機械 gate**，只能靠稽核（見 metadata.explanation_audit）
  // 與人工複驗。這句話寫在這裡，是為了不讓下面這道很弱的 gate 被誤當成保護傘。
  //
  // 下面這道只做一件事，而且只做得到這一件：**引到一個根本不存在的條號時變紅。**
  // 零假陽性（條號要嘛在釘選法條裡、要嘛不在），成本為零。
  it('解析引用的法條條號必須真的存在（釘選的 6 部法規）', () => {
    const CN: Record<string, number> = {
      一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
    };
    const toNum = (s: string): number => {
      if (/^\d+$/.test(s)) return Number(s);
      if (s === '十') return 10;
      if (s.startsWith('十')) return 10 + (CN[s.slice(1)] ?? 0);
      if (s.includes('十')) {
        const [a, b] = s.split('十');
        return (CN[a] ?? 0) * 10 + (b ? CN[b] ?? 0 : 0);
      }
      return CN[s] ?? 0;
    };

    // 別名一律沿用上面那份 ALIASES —— 不要在這裡再抄一份法規名稱清單。
    // 「兩份清單一定會漂」在這個 repo 已經應驗過三次。
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pat = new RegExp(
      `(?:《)?(${ALIASES.map(([n]) => esc(n)).join('|')})(?:》)?` +
        `\\s*(?:第\\s*([0-9一二三四五六七八九十]+)\\s*條|§\\s*(\\d+))`,
      'g'
    );
    const NAME2PCODE = new Map(ALIASES);

    const check = (items: BankItem[], label: (i: BankItem) => string, bad: string[]) => {
      for (const it of items) {
        const ex = it.explanation ?? '';
        if (!ex) continue;
        for (const m of ex.matchAll(pat)) {
          const pcode = NAME2PCODE.get(m[1])!;
          const art = String(m[2] ? toNum(m[2]) : Number(m[3]));
          if (!(art in PINNED[pcode].articles)) {
            bad.push(`${label(it)}：解析引「${m[1]} 第 ${art} 條」—— 該法根本沒有這一條`);
          }
        }
      }
    };

    const bad: string[] = [];
    check(MAIN, (i) => i.id ?? `gist[${i.index}]`, bad);
    check(POOL, (i) => i.id!, bad);
    expect(bad, '解析引用了一個不存在的法條條號').toEqual([]);
  });
});
