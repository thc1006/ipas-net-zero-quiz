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
