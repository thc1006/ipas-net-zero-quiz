// 文件裡的題數不得與資料漂移。
//
// 起因：資料已經是 783 題（799 → 782 去重 → 783 拆題），但 README 頂部仍寫「799 題主題庫」，
// CONTENT-CURRENCY.md 仍寫「119 題 time_sensitive」（實際 115）。
// 這種漂移不是打錯字 —— 它會讓讀者對題庫規模與查證範圍產生錯誤認知，
// 而且每次改資料都要記得手動同步 N 個地方，遲早會忘。
//
// 所以把「文件宣稱的數字」和「資料的真實數字」綁在一起測。
// 改了資料卻沒改文件（或反過來），CI 當場擋下。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import datasetRaw from './integrated_dataset.json';
import poolRaw from './practice_pool.json';
import manifestRaw from './restoration-manifest.json';
import { hasPrimarySource } from '../utils/source-authority';

interface Item {
  quality_flags?: string[];
  metadata?: { valid_as_of?: string };
}
const DS = datasetRaw as unknown as {
  meta: { total_questions: number; content_review: { reverified_count: number; last_review_date: string } };
  gist_items: Item[];
  our_unique_items: Item[];
};
const POOL = poolRaw as unknown as {
  items: { provenance: { source_type: string } }[];
};

const ALL = [...DS.gist_items, ...DS.our_unique_items];
const TOTAL = DS.meta.total_questions;
const TIME_SENSITIVE = ALL.filter((i) => (i.quality_flags ?? []).includes('time_sensitive')).length;
const POOL_TOTAL = POOL.items.length;
// 細項也要釘 —— 只釘總數的話，「55 + 96 = 151」這種同一份文件自打嘴巴的矛盾抓不到
const POOL_EXTERNAL_MOCK = POOL.items.filter(
  (q) => q.provenance.source_type === 'external_mock'
).length;
const POOL_AI_GENERATED = POOL.items.filter(
  (q) => q.provenance.source_type === 'ai_generated'
).length;
const REVERIFIED = DS.meta.content_review.reverified_count;

const MAN = manifestRaw as unknown as {
  _meta: { restored_count: number; source_question_total: number };
};
const RESTORED_COUNT = MAN._meta.restored_count;      // 159
const SOURCE_TOTAL = MAN._meta.source_question_total; // 170

// repo root = quiz-app/src/data -> ../../..
const root = resolve(__dirname, '..', '..', '..');
const read = (f: string) => readFileSync(resolve(root, f), 'utf8');
const README = read('README.md');
const CURRENCY = read('CONTENT-CURRENCY.md');
// 這兩個是「對外」的門面：index.html 是搜尋引擎與社群分享卡看的，
// llms.txt 是 AI 爬蟲看的。它們同樣寫著題數，卻一直沒有任何測試在看 ——
// 於是兩邊都停在「719 題官方考古題 + 151 題加強練習」，跟資料（783 + 157）
// 差了 64 題與 6 題，而且跟 README、跟 GitHub About 各說各話。
// 同一個數字散在五個地方、沒有一個地方在對帳，漂移是遲早的事。
const INDEX_HTML = read('quiz-app/index.html');
const LLMS_TXT = read('quiz-app/public/llms.txt');
// README 精簡後，證據鏈的細節搬到 DATA-PROVENANCE.md —— 那裡也寫著題數（159 還原、
// 170 來源題）。**任何寫著數字的檔案都必須進這道 gate**，否則就只是把漂移搬到一個
// 沒人看守的地方，重蹈這整輪在修的覆轍。
const PROVENANCE = read('DATA-PROVENANCE.md');

describe('文件的題數必須與資料一致', () => {
  it('README 的主題庫題數（表格）必須等於 meta.total_questions', () => {
    const m = README.match(/\*\*主題庫\*\*\s*\|\s*\*\*(\d+)\s*題\*\*/);
    expect(m, 'README 找不到「| **主題庫** | **N 題** |」').not.toBeNull();
    expect(Number(m![1])).toBe(TOTAL);
  });

  it('README 的加強練習池題數（表格）必須等於練習池題數', () => {
    const m = README.match(/\*\*加強練習池\*\*[^|]*\|\s*\*\*(\d+)\s*題\*\*/);
    expect(m, 'README 找不到「| **加強練習池**… | **N 題** |」').not.toBeNull();
    expect(Number(m![1])).toBe(POOL_TOTAL);
  });

  it('README「N 題的答案會隨法規變動」必須等於 time_sensitive 題數', () => {
    const m = README.match(/\*\*(\d+)\s*題\*\*的答案會隨法規變動/);
    expect(m, 'README 找不到「**N 題**的答案會隨法規變動」').not.toBeNull();
    expect(Number(m![1])).toBe(TIME_SENSITIVE);
  });

  it('README「本輪只實查 X / Y 題」必須等於 reverified_count / total', () => {
    const m = README.match(/本輪只實查\s*\*\*(\d+)\s*\/\s*(\d+)\*\*\s*題/);
    expect(m, 'README 找不到「本輪只實查 **X / Y** 題」').not.toBeNull();
    expect(Number(m![1])).toBe(REVERIFIED);
    expect(Number(m![2])).toBe(TOTAL);
  });

  // README 精簡時，「159 題重建」這個數字從 README 移到了 DATA-PROVENANCE.md。
  // 它同時出現在兩個地方（README 的信任摘要 + DATA-PROVENANCE 的細節），兩邊都要對。
  it('README 與 DATA-PROVENANCE 宣稱的「N 題由來源 PDF 重建」必須一致且等於 manifest', () => {
    const inReadme = README.match(/(\d+)\s*題由來源 PDF/);
    const inProv = PROVENANCE.match(/\*\*(\d+)\s*題\*\*是從來源 PDF 重建|(\d+)\s*題是從來源 PDF/);
    expect(inReadme, 'README 找不到「N 題由來源 PDF …」').not.toBeNull();
    expect(Number(inReadme![1])).toBe(RESTORED_COUNT);
    expect(inProv, 'DATA-PROVENANCE 找不到還原題數').not.toBeNull();
  });

  it('CONTENT-CURRENCY「本輪只實查了 X / Y 題」必須與資料一致', () => {
    const m = CURRENCY.match(/本輪只實查了\s*\*\*(\d+)\s*\/\s*(\d+)\*\*\s*題/);
    expect(m, 'CONTENT-CURRENCY 找不到「本輪只實查了 **X / Y** 題」').not.toBeNull();
    expect(Number(m![1])).toBe(REVERIFIED);
    expect(Number(m![2])).toBe(TOTAL);
  });

  it('CONTENT-CURRENCY「N 題標記 time_sensitive」必須與資料一致', () => {
    const m = CURRENCY.match(/\*\*(\d+)\s*題\*\*標記\s*`time_sensitive`/);
    expect(m, 'CONTENT-CURRENCY 找不到「**N 題**標記 `time_sensitive`」').not.toBeNull();
    expect(Number(m![1])).toBe(TIME_SENSITIVE);
  });

  // 這些數字是「宣稱」，必須有資料支撐；抓不到就代表文件被改壞了或格式漂了
  it('README 不得再出現已作廢的題數（799 / 782 / 647 / 648）', () => {
    const stale = ['799 題主題庫', '782 題主題庫', '647 題主題庫', '648 題主題庫'].filter((s) =>
      README.includes(s)
    );
    expect(stale).toEqual([]);
  });
});

// index.html / llms.txt 是「對外的門面」——
// 搜尋結果摘要、Facebook / X / LinkedIn 分享卡、AI 爬蟲看到的都是這裡的數字。
// 它們一路寫著「719 題官方考古題 + 151 題加強練習」，跟任何一個版本的資料都對不上，
// 而且沒有任何測試看得到它們。README 有 gate、這裡沒有 —— 於是就漂走了。
describe('對外門面（index.html / llms.txt）的題數必須與資料一致', () => {
  const eachDoc: Array<[string, string]> = [
    ['index.html', INDEX_HTML],
    ['llms.txt', LLMS_TXT],
  ];

  it.each(eachDoc)('%s 宣稱的「N 題主題庫」必須等於 meta.total_questions', (_name, doc) => {
    const hits = [...doc.matchAll(/(\d+)\s*題主題庫/g)].map((m) => Number(m[1]));
    expect(hits.length, '找不到任何「N 題主題庫」字樣').toBeGreaterThan(0);
    for (const n of hits) expect(n).toBe(TOTAL);
  });

  it.each(eachDoc)('%s 宣稱的「N 題加強練習」必須等於練習池題數', (_name, doc) => {
    const hits = [...doc.matchAll(/(\d+)\s*題加強練習/g)].map((m) => Number(m[1]));
    expect(hits.length, '找不到任何「N 題加強練習」字樣').toBeGreaterThan(0);
    for (const n of hits) expect(n).toBe(POOL_TOTAL);
  });

  // 「官方考古題」是過度宣稱：主題庫含 our_unique_items（我們自行整理／驗證的題目），
  // 並不是全部都出自官方考古題。對外文案不該這樣講。
  it.each(eachDoc)('%s 不得把整個主題庫稱作「官方考古題」', (_name, doc) => {
    expect(doc).not.toMatch(/\d+\s*題官方考古題/);
  });

  // 只釘總數是不夠的 —— llms.txt 一路寫著「55 題 external_mock + 96 題 ai_generated」，
  // 加起來 151，跟同一份檔案裡自己寫的總數對不上，**而且就寫在相鄰兩行**。
  // gate 只看總數，於是這個矛盾一直沒被發現。
  it('llms.txt 的 external_mock / ai_generated 細項必須與資料一致，且加總等於總數', () => {
    const em = LLMS_TXT.match(/(\d+)\s*題\s*`external_mock`/);
    const ai = LLMS_TXT.match(/(\d+)\s*題\s*`ai_generated`/);
    expect(em, '找不到「N 題 `external_mock`」字樣').not.toBeNull();
    expect(ai, '找不到「N 題 `ai_generated`」字樣').not.toBeNull();
    expect(Number(em![1])).toBe(POOL_EXTERNAL_MOCK);
    expect(Number(ai![1])).toBe(POOL_AI_GENERATED);
    expect(
      Number(em![1]) + Number(ai![1]),
      '細項加起來不等於總數 —— 同一份文件在自打嘴巴'
    ).toBe(POOL_TOTAL);
  });

  // 對外文案不得對 AI 產題做出假的保證。
  // llms.txt 原本寫「每題經獨立驗證代理 cross-check 通過」—— 那個「驗證」是 AI 自評，
  // 而我們找到的 13 個實質缺陷，13 個當初全部被判 CONFIRMED。
  // llms.txt 是餵給 AI 爬蟲的檔案，這句假話會被其他系統當成事實轉述出去。
  // （UI 文案的同一道檢查在 components/ai-disclosure.test.ts。）
  it.each(eachDoc)('%s 不得宣稱 AI 產題「已驗證 / 驗證通過」', (_name, doc) => {
    for (const re of [/已通過(獨立)?驗證/, /經獨立驗證/, /cross-?check\s*通過/i, /交叉比對通過/]) {
      expect(doc, `出現假保證：${re}`).not.toMatch(re);
    }
  });

  it('og:image 必須是絕對網址且為點陣圖（爬蟲不吃相對路徑，也不吃 SVG）', () => {
    const m = INDEX_HTML.match(/property="og:image"\s*\n?\s*content="([^"]+)"/);
    expect(m, 'index.html 找不到 og:image').not.toBeNull();
    const url = m![1];
    expect(url).toMatch(/^https:\/\//);
    expect(url).toMatch(/\.(jpg|jpeg|png|webp)$/i);
  });
});

// DATA-PROVENANCE.md 是「證據鏈」的說明文件 —— 它自己就寫著 159（還原）與 170（來源總題數）。
// 這些數字如果跟 manifest 漂掉，那份文件就變成在為一條不存在的證據鏈背書。
//
// 這正是 README 精簡時最容易踩的坑：把數字搬到一個新檔案，卻忘了把 gate 一起搬過去 ——
// 於是「文件不能對資料說謊」這個保證，在新檔案上直接失效。
describe('DATA-PROVENANCE.md 的數字必須與 manifest 一致', () => {
  it('「159 題」還原數必須等於 manifest 的 restored_count', () => {
    const hits = [...PROVENANCE.matchAll(/(\d+)\s*題(?:是從|由)來源 PDF 重建/g)].map((m) => Number(m[1]));
    expect(hits.length, 'DATA-PROVENANCE 找不到「N 題（是從|由）來源 PDF 重建」').toBeGreaterThan(0);
    for (const n of hits) expect(n).toBe(RESTORED_COUNT);
  });

  it('「170 題」來源總題數必須等於 manifest 的 source_question_total', () => {
    const m = PROVENANCE.match(/全部\s*\*\*(\d+)\s*題\*\*/);
    expect(m, 'DATA-PROVENANCE 找不到「來源 PDF 全部 **N 題**」').not.toBeNull();
    expect(Number(m![1])).toBe(SOURCE_TOTAL);
  });

  it('disposition 表格裡的數字必須與 manifest 實際相符', () => {
    // 表格形如：| `restored` | 159 | … |   與   | `UNACCOUNTED` | **0** | … |
    const restored = PROVENANCE.match(/\|\s*`restored`\s*\|\s*\**(\d+)\**\s*\|/);
    expect(restored, 'DATA-PROVENANCE 的 disposition 表格找不到 restored').not.toBeNull();
    expect(Number(restored![1])).toBe(RESTORED_COUNT);

    const unaccounted = PROVENANCE.match(/\|\s*`UNACCOUNTED`\s*\|\s*\**(\d+)\**\s*\|/);
    expect(unaccounted, '找不到 UNACCOUNTED').not.toBeNull();
    expect(
      Number(unaccounted![1]),
      'UNACCOUNTED 必須是 0 —— 只要有一題下落不明，這份證據鏈就不成立'
    ).toBe(0);
  });

  it('README 必須連到 CONTENT-CURRENCY 與 DATA-PROVENANCE（否則細節等於被藏起來）', () => {
    expect(README).toMatch(/\(CONTENT-CURRENCY\.md\)/);
    expect(README).toMatch(/\(DATA-PROVENANCE\.md\)/);
  });
});

// README 的 H1 是**可被搜尋引擎索引的**（GitHub 會把它當成 repo 首頁的標題）。
// 考生是靠「iPAS 淨零碳規劃管理師考古題」這類字串找到這個專案的。
//
// 精簡 README 時，我為了視覺簡潔把 H1 從
//   「淨零碳規劃管理師備考神器 | iPAS 淨零碳規劃管理師考古題」
// 砍成
//   「淨零碳規劃管理師備考神器」
// —— 直接刪掉了讓人找得到這個專案的關鍵字，而**沒有任何一條測試會紅**。
//
// 「排版好看」不值得用「沒人找得到」去換。標題不是裝飾，是入口。
describe('README 的 H1 必須保留可被搜尋到的關鍵字', () => {
  const h1 = README.split('\n').find((l) => l.startsWith('# '));

  it('H1 存在', () => {
    expect(h1, 'README 沒有 H1').toBeDefined();
  });

  it.each([
    ['iPAS', '證照名稱的英文縮寫 —— 考生最常用的搜尋詞'],
    ['淨零碳規劃管理師', '證照全名'],
    ['考古題', '考生真正在搜尋的東西'],
  ])('H1 必須含「%s」（%s）', (kw) => {
    expect(h1, `H1 掉了關鍵字「${kw}」：${h1}`).toContain(kw);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// gate 缺口補完
//
// 對抗式審查做了變異測試，發現這道 gate 只守住了一半的數字 —— 以下這些改壞了
// **CI 照樣全綠**：README 的「考科一 434 + 考科二 346」、「55 題模擬 + 102 題 AI」、
// DATA-PROVENANCE 的 duplicate 數與「159/159」、以及最刺眼的
// **disposition 三個分類的加總（159+8+3=170）根本沒人算**
// —— 那張表賣的就是「每一題都有交代」，而「有交代」這件事本身沒被驗證。
//
// docs-counts.test.ts 自己的註解在罵「把數字搬到新檔案卻忘了把 gate 搬過去」，
// 結果 gate 只搬了一半。這裡補完。
describe('gate 缺口：README / DATA-PROVENANCE 的每一個數字都要有人守', () => {
  const BY_SUBJECT = (DS.meta as unknown as { by_subject: Record<string, number> }).by_subject;
  const POOL_META = (poolRaw as unknown as {
    _meta: { totals: { external_mock: number; ai_generated: number; total: number } };
  })._meta.totals;

  it('README 的「考科一 N + 考科二 M」必須等於 meta.by_subject', () => {
    const m = README.match(/考科一\s*(\d+)\s*\+\s*考科二\s*(\d+)/);
    expect(m, 'README 找不到「考科一 N + 考科二 M」').not.toBeNull();
    expect(Number(m![1])).toBe(BY_SUBJECT['考科1']);
    expect(Number(m![2])).toBe(BY_SUBJECT['考科2']);
    expect(Number(m![1]) + Number(m![2])).toBe(TOTAL);
  });

  it('README 的「N 題公開模擬題 + M 題 AI 產題」必須等於 pool._meta.totals', () => {
    const m = README.match(/(\d+)\s*題公開模擬題\s*\+\s*(\d+)\s*題 AI 產題/);
    expect(m, 'README 找不到「N 題公開模擬題 + M 題 AI 產題」').not.toBeNull();
    expect(Number(m![1])).toBe(POOL_META.external_mock);
    expect(Number(m![2])).toBe(POOL_META.ai_generated);
    expect(Number(m![1]) + Number(m![2])).toBe(POOL_TOTAL);
  });

  // README 把「有來源」拆成三級 —— **三個數字都要有人守**。
  //
  // ⚠️ 原本這道 gate 只守「有沒有來源」，但 README 的文字寫的是「附**一手**來源」——
  // **文字宣稱的東西，和 gate 驗證的東西，根本不是同一件事。**
  // 那正是這整輪在修的病：一個看起來被守住、其實沒被守住的宣稱。
  //
  // 三級（由強到弱）：
  //   ① 有逐字引文且經機械驗證（metadata.evidence）—— 最強：來源網頁被抓回來逐字比對過
  //   ② 有一手來源 URL（source-authority.ts 的 PRIMARY）—— 連結是活的，但沒人保證內容相符
  //   ③ 完全沒有來源 —— 無從查證
  it('README 的三級來源覆蓋率（逐字引文／一手來源／無來源）都必須與資料一致', () => {
    const urlsOf = (i: Item): string[] => {
      const md = i.metadata as unknown as { sources?: unknown[] } | undefined;
      const out = (md?.sources ?? []).filter(
        (u): u is string => typeof u === 'string' && /^https?:\/\//.test(u)
      );
      const src = (i as unknown as { source?: { url?: unknown } }).source;
      if (src && typeof src === 'object' && typeof src.url === 'string') out.push(src.url);
      return out;
    };
    const hasEvidence = ALL.filter(
      (i) => (i.metadata as unknown as { evidence?: unknown })?.evidence != null
    ).length;
    const hasPrimary = ALL.filter((i) => hasPrimarySource(urlsOf(i))).length;
    const noSource = ALL.filter((i) => urlsOf(i).length === 0).length;

    const poolItems = (poolRaw as unknown as { items: { sources?: string[]; provenance?: { evidence?: unknown } }[] }).items;
    const poolEvidence = poolItems.filter((q) => q.provenance?.evidence != null).length;
    const poolPrimary = poolItems.filter((q) => hasPrimarySource(q.sources ?? [])).length;

    // README 的表格：| **① …** | … | **100 / 773** | **29 / 154** |
    const row = (label: string) =>
      README.match(new RegExp(`\\|[^|\\n]*${label}[^|\\n]*\\|[^|\\n]*\\|\\s*\\*?\\*?(\\d+)\\s*/\\s*(\\d+)\\s*\\*?\\*?\\s*\\|\\s*\\*?\\*?(\\d+)\\s*/\\s*(\\d+)`));

    const e = row('逐字引文');
    expect(e, 'README 找不到「有逐字引文」那一列').not.toBeNull();
    expect(Number(e![1]), '主題庫「有逐字引文」的題數與資料不符').toBe(hasEvidence);
    expect(Number(e![2])).toBe(TOTAL);
    expect(Number(e![3]), '練習池「有逐字引文」的題數與資料不符').toBe(poolEvidence);
    expect(Number(e![4])).toBe(POOL_TOTAL);

    const p = row('一手來源');
    expect(p, 'README 找不到「有一手來源」那一列').not.toBeNull();
    expect(Number(p![1]), '主題庫「有一手來源」的題數與資料不符').toBe(hasPrimary);
    expect(Number(p![3]), '練習池「有一手來源」的題數與資料不符').toBe(poolPrimary);

    const n = row('完全沒有來源');
    expect(n, 'README 找不到「完全沒有來源」那一列').not.toBeNull();
    expect(Number(n![1]), '主題庫「完全沒有來源」的題數與資料不符').toBe(noSource);
  });

  it('README 的「N 題答案曾被更正」必須等於實際 prior_answer 的題數', () => {
    const corrected = ALL.filter(
      (i) => (i.metadata as unknown as { prior_answer?: string })?.prior_answer != null
    ).length;
    const m = README.match(/(\d+)\s*題答案曾被更正/);
    expect(m, 'README 找不到「N 題答案曾被更正」').not.toBeNull();
    expect(Number(m![1])).toBe(corrected);
  });

  // 「引用複驗」的結果同樣必須三向錨定：README == meta == 資料裡實際的 citation_audit 標記。
  //
  // 這一輪最重要的發現，是**「有一手來源 URL」這個標籤過去幾乎沒有保證力**：
  // 383 題裡有 31 題**引錯地方**（那一頁根本不含這個主張），而**它們全部都回 HTTP 200** ——
  // 連結健康檢查一個都抓不到。
  it('README 的「引用複驗」數字必須等於 meta，且 meta 必須等於資料裡的 citation_audit 標記', () => {
    const a = (DS.meta as unknown as Record<string, unknown>).citation_audit as {
      population: number;
      supported: number;
      wrong_source: number;
      replaced: number;
      disputed: number;
      no_quote: number;
      dead: number;
    };
    expect(a, 'meta.citation_audit 不見了').toBeDefined();

    // ① 錨在資料上：實際被標記的 citation_audit verdict 分佈
    const verdicts = (i: unknown): string | undefined => {
      const md = (i as { metadata?: { citation_audit?: { verdict?: string } } }).metadata;
      const pv = (i as { provenance?: { citation_audit?: { verdict?: string } } }).provenance;
      return md?.citation_audit?.verdict ?? pv?.citation_audit?.verdict;
    };
    const poolItems = (poolRaw as unknown as { items: unknown[] }).items;
    const all = [...ALL, ...poolItems];
    const count = (v: string) => all.filter((i) => verdicts(i) === v).length;

    expect(count('supported'), 'meta.supported 與資料實算不符').toBe(a.supported);
    expect(count('citation_replaced'), 'meta.replaced 與資料實算不符').toBe(a.replaced);
    expect(count('citation_disputed'), 'meta.disputed 與資料實算不符').toBe(a.disputed);
    expect(count('no_quote'), 'meta.no_quote 與資料實算不符').toBe(a.no_quote);
    expect(count('dead'), 'meta.dead 與資料實算不符').toBe(a.dead);
    expect(a.wrong_source, 'wrong_source != replaced + disputed').toBe(a.replaced + a.disputed);
    expect(a.supported, '一題都沒複驗 —— 這條測試在空轉').toBeGreaterThan(0);

    // ② 每一題「引用被換掉」的，都必須真的留下了逐字引文（否則「換了更好的來源」是空口說的）
    for (const i of all) {
      if (verdicts(i) === 'citation_replaced') {
        const md = (i as { metadata?: { evidence?: unknown[] } }).metadata;
        const pv = (i as { provenance?: { evidence?: unknown[] } }).provenance;
        const ev = md?.evidence ?? pv?.evidence;
        expect(ev, 'citation_replaced 卻沒有 evidence —— 憑什麼說新來源更好？').toBeTruthy();
      }
    }

    // ③ README 上的數字要對得上
    const sup = README.match(/\| ✅ 引用正確[^|]*\| \*\*(\d+)\*\*/);
    expect(sup, 'README 找不到「引用正確」那一列').not.toBeNull();
    expect(Number(sup![1])).toBe(a.supported);

    const wr = README.match(/\| 🔧 \*\*引錯地方[^|]*\| \*\*(\d+)\*\*/);
    expect(wr, 'README 找不到「引錯地方」那一列').not.toBeNull();
    expect(Number(wr![1]), 'README 的「引錯地方」題數與 meta 不符').toBe(a.wrong_source);

    const rep = README.match(/\*\*(\d+)\s*題\*\*已換成經機械驗證的一手來源/);
    expect(rep, 'README 找不到「N 題已換成經機械驗證的一手來源」').not.toBeNull();
    expect(Number(rep![1])).toBe(a.replaced);

    // ⚠️ 錨點要綁在**結構**上，不要綁在**散文**上。
    // 這條原本錨在「另外 **N 題**代理說引錯」—— 那句話後來被改寫，正則就對不上了。
    // 同一個病剛在 tools/sync_derived_counts.py 咬過一次：README 的「一手來源」列
    // 被加了一句警語，同步規則從此靜靜死掉，740 凍了一整輪沒人發現。
    //
    // 改錨在 `citation_audit.verdict = citation_disputed` —— 那是**欄位名**，
    // 它跟著資料格式走，不會因為有人潤稿就消失。
    const dis = README.match(/\*\*(\d+)\s*題\*\*[^\n]*`citation_audit\.verdict = citation_disputed`/);
    expect(dis, 'README 找不到「N 題仍標記 citation_disputed」').not.toBeNull();
    expect(Number(dis![1])).toBe(a.disputed);
  });

  // 「無來源那批的錯誤率」曾經是 README 上**沒人守的一句散文**，於是它漂了：
  // 舊版寫「抽 40 題、29 題可驗證、錯 0 題 → 錯誤率 0%」。
  // 後來把那 382 題**全部**查完，真實錯誤率是 3.3%（12/363）——
  // **0% 是小樣本僥倖，而且是往「讓人安心」的方向錯。**
  //
  // 現在這個量測寫進 `meta.no_source_audit`，並由這條 gate 三向比對：
  //   README 的數字 == meta 宣稱的數字 == 資料裡實際被標記的缺陷題數。
  // 只守 README 對得上 meta 是不夠的 —— 那兩個都是人寫的，會一起說謊。
  // 必須有一端錨在**資料本身**上。
  it('README 的「無來源那批」錯誤率必須等於 meta 宣稱值，且 meta 必須等於資料實算', () => {
    const audit = (DS.meta as unknown as Record<string, unknown>).no_source_audit as {
      population: number;
      no_primary_source: number;
      verifiable: number;
      defects: number;
      error_rate_pct: number;
    };
    expect(audit, 'meta.no_source_audit 不見了').toBeDefined();

    // ① meta 的 defects 必須等於資料裡真的被標記的題數 —— 這一端錨在資料上
    const tagged = ALL.filter(
      (i) => (i.metadata as unknown as { found_by?: string })?.found_by === 'r3-no-source-audit'
    ).length;
    expect(tagged, 'meta.no_source_audit.defects 與實際標記 found_by 的題數不符').toBe(
      audit.defects
    );
    expect(tagged, '一題都沒標記 —— 這條測試在空轉').toBeGreaterThan(0);

    // ② 每一題被標記的缺陷，都必須真的留下了 prior_answer（否則「缺陷」是空口說的）
    for (const i of ALL) {
      const md = i.metadata as unknown as { found_by?: string; prior_answer?: string };
      if (md?.found_by === 'r3-no-source-audit') {
        const id =
          (i as unknown as { item_id?: string }).item_id ??
          `gist[${(i as unknown as { index?: number }).index}]`;
        expect(md.prior_answer, `${id} 標了 found_by 卻沒有 prior_answer`).toBeTruthy();
      }
    }

    // ③ 算術要自洽
    expect(audit.verifiable, 'verifiable != population - no_primary_source').toBe(
      audit.population - audit.no_primary_source
    );
    const rate = Math.round((audit.defects / audit.verifiable) * 1000) / 10;
    expect(audit.error_rate_pct, 'error_rate_pct 與 defects/verifiable 對不上').toBe(rate);

    // ④ README 上的每一個數字都要對得上
    const m = README.match(/把\s*(\d+)\s*題全部查一遍/);
    expect(m, 'README 找不到「把 N 題全部查一遍」').not.toBeNull();
    expect(Number(m![1]), 'README 的母體題數與 meta 不符').toBe(audit.population);

    const v = README.match(/可判斷的\s*\*\*(\d+)\s*題\*\*/);
    expect(v, 'README 找不到「可判斷的 N 題」').not.toBeNull();
    expect(Number(v![1]), 'README 的可判斷題數與 meta 不符').toBe(audit.verifiable);

    const dfx = README.match(/\*\*(\d+)\s*題答案是錯的\*\*/);
    expect(dfx, 'README 找不到「N 題答案是錯的」').not.toBeNull();
    expect(Number(dfx![1]), 'README 的缺陷題數與 meta 不符').toBe(audit.defects);

    const r = README.match(/實測錯誤率\s*=\s*(\d+)\s*\/\s*(\d+)\s*=\s*([\d.]+)\s*%/);
    expect(r, 'README 找不到「實測錯誤率 = a / b = c%」').not.toBeNull();
    expect(Number(r![1])).toBe(audit.defects);
    expect(Number(r![2])).toBe(audit.verifiable);
    expect(Number(r![3])).toBe(audit.error_rate_pct);

    // ⚠️ 這裡原本還有第 ⑤ 條：「README 不准再出現『點估計錯誤率 0%』」。
    // **它立刻誤報了** —— 因為 README 現在正**引用**那句舊的錯話，當作一個教訓在講。
    // 一個分不出「宣稱 0%」與「引述自己曾經宣稱 0%」的檢查器，
    // 懲罰的是誠實，而不是錯誤。
    //
    // 而且它是多餘的：上面 ④ 已經要求 README 必須寫出
    // 「實測錯誤率 = 12 / 363 = 3.3%」且三個數字都要對得上 meta 與資料。
    // 只要有人把舊段落改回去，④ 就會立刻紅。**負面規則沒有增加任何防護，只增加了偽陽性。**
    // 「假陽性比真陽性多的 checker 不要 ship。」
  });

  // 這條是補一個**真的漏過**的洞：總數 16 有人守，但底下那句
  //「其中 10 題附一手來源 URL，另外 3 題的依據是標準條文本身」**沒有人守** ——
  // 於是它一路漂到 10 + 3 = 13 ≠ 16，寫在 README 上好一陣子都沒被發現。
  // 只守總數、不守組成，等於默許組成說謊。
  it('README 的更正題來源組成（N 題有 URL／M 題依標準條文）必須等於實際', () => {
    const corrected = ALL.filter(
      (i) => (i.metadata as unknown as { prior_answer?: string })?.prior_answer != null
    );
    const withUrl = corrected.filter(
      (i) => ((i.metadata as unknown as { sources?: unknown[] })?.sources ?? []).length > 0
    ).length;
    const withoutUrl = corrected.length - withUrl;

    const a = README.match(/其中\s*(\d+)\s*題附一手來源 URL/);
    expect(a, 'README 找不到「其中 N 題附一手來源 URL」').not.toBeNull();
    expect(Number(a![1]), '「附一手來源 URL」的更正題數與資料不符').toBe(withUrl);

    const b = README.match(/另外\s*(\d+)\s*題的依據是標準條文/);
    expect(b, 'README 找不到「另外 N 題的依據是標準條文」').not.toBeNull();
    expect(Number(b![1]), '「依標準條文」的更正題數與資料不符').toBe(withoutUrl);

    // 組成必須加得回總數 —— 這正是舊版 10 + 3 = 13 ≠ 16 沒被抓到的原因
    expect(Number(a![1]) + Number(b![1]), 'README 的組成加不回更正總數').toBe(corrected.length);
  });

  it('README 的「下一個到期日」必須與 CONTENT-CURRENCY 一致', () => {
    const inReadme = README.match(/\*\*(\d{4}-\d{2}-\d{2})：ISAE 3410 撤回/);
    expect(inReadme, 'README 找不到下一個到期日').not.toBeNull();
    expect(
      CURRENCY.includes(inReadme![1]),
      `README 宣稱的到期日 ${inReadme![1]} 在 CONTENT-CURRENCY.md 裡找不到 —— 可能是捏造的`
    ).toBe(true);
  });

  it('DATA-PROVENANCE 的 disposition 三個分類必須真的加總為 170', () => {
    const rows = {
      restored: PROVENANCE.match(/\|\s*`restored`\s*\|\s*\**(\d+)\**/),
      duplicate_within_source: PROVENANCE.match(/\|\s*`duplicate_within_source`\s*\|\s*\**(\d+)\**/),
      duplicate_in_dataset: PROVENANCE.match(/\|\s*`duplicate_in_dataset`\s*\|\s*\**(\d+)\**/),
      UNACCOUNTED: PROVENANCE.match(/\|\s*`UNACCOUNTED`\s*\|\s*\**(\d+)\**/),
    };
    const num = (name: keyof typeof rows) => {
      const m = rows[name];
      expect(m, `DATA-PROVENANCE 的 disposition 表格找不到 ${name}`).not.toBeNull();
      return Number(m![1]);
    };
    const restored = num('restored');
    const dupSrc = num('duplicate_within_source');
    const dupDs = num('duplicate_in_dataset');
    const unacc = num('UNACCOUNTED');

    // 跟 manifest 的實際 disposition 逐項比對
    const summary = (manifestRaw as unknown as {
      _meta: { disposition_summary: Record<string, number> };
    })._meta.disposition_summary;
    expect(restored).toBe(summary['restored'] ?? 0);
    expect(dupSrc).toBe(summary['duplicate_within_source'] ?? 0);
    expect(dupDs).toBe(summary['duplicate_in_dataset'] ?? 0);
    expect(unacc).toBe(0);

    // **加總** —— 那張表賣的就是「每一題都有交代」，加總本身必須成立
    expect(
      restored + dupSrc + dupDs + unacc,
      '文件裡的 disposition 加總不等於來源總題數 —— 「每一題都有交代」這個宣稱就不成立'
    ).toBe(SOURCE_TOTAL);
  });

  it('DATA-PROVENANCE 的「實測 N/M 相符」必須等於 restored_count', () => {
    const m = PROVENANCE.match(/實測\s*\*\*(\d+)\s*\/\s*(\d+)\*\*\s*相符/);
    expect(m, 'DATA-PROVENANCE 找不到「實測 **N/M** 相符」').not.toBeNull();
    expect(Number(m![1])).toBe(RESTORED_COUNT);
    expect(Number(m![2])).toBe(RESTORED_COUNT);
  });

  it('DATA-PROVENANCE 必須保有「連結健康檢查」這一節（整節被刪也要抓到）', () => {
    expect(PROVENANCE).toMatch(/##\s*連結健康檢查/);
    expect(PROVENANCE).toMatch(/DEAD_DNS/);
  });
});
