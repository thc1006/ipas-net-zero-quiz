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

interface Item {
  quality_flags?: string[];
  metadata?: { valid_as_of?: string };
}
const DS = datasetRaw as unknown as {
  meta: { total_questions: number; content_review: { reverified_count: number; last_review_date: string } };
  gist_items: Item[];
  our_unique_items: Item[];
};
const POOL = poolRaw as unknown as { items: unknown[] };

const ALL = [...DS.gist_items, ...DS.our_unique_items];
const TOTAL = DS.meta.total_questions;
const TIME_SENSITIVE = ALL.filter((i) => (i.quality_flags ?? []).includes('time_sensitive')).length;
const POOL_TOTAL = POOL.items.length;
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
