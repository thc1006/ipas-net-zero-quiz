// 題庫結構完整性 gate
//
// 起因：@weiyunghsu 回報考科二 253–289「題目與選項錯置」。追下去發現成因是來源 PDF 為雙欄
// 排版，轉純文字時左右欄交錯，把鄰題的文字插進題幹、選項重複或缺漏，連頁首頁尾
// （'ML (2024.08.16 整理)'、'考科 1 …-模擬試題'）都被吃進選項裡。實際受影響的是 83 題
// （考科一 324–362 也中，回報者只看到一半）。
//
// 重點是：這一整類壞法 100% 可以機器測出來 —— 選項不是 4 個、key 重複、答案不在選項裡、
// 文字裡有換行或 PDF 頁首頁尾。人工逐題看是看不完的，所以把它變成 gate。
//
// 另外釘住「修正必須真的被套用」：_correction_note 掛上去但 answer 沒改，正是坎昆那題
// （gist[304]）能默默錯到線上的原因。
import { describe, it, expect } from 'vitest';
import datasetRaw from './integrated_dataset.json';

interface Opt {
  key: string;
  text: string;
}
interface Item {
  index?: number;
  item_id?: string;
  stem: string;
  options: Opt[];
  answer?: string | null;
  explanation?: string | null;
  exam_subject?: string;
  quality_flags?: string[];
  _correction_note?: string;
  source?: { url?: string };
  metadata?: { prior_answer?: string; sources?: string[]; valid_as_of?: string };
}

const DS = datasetRaw as unknown as {
  meta: Record<string, unknown>;
  gist_items: Item[];
  our_unique_items: Item[];
};

const ALL: Item[] = [...DS.gist_items, ...DS.our_unique_items];
const who = (it: Item) => it.item_id ?? `gist[${it.index}]`;

// 來源 PDF 的頁首/頁尾，絕對不該出現在題幹或選項裡
const PDF_FURNITURE = [/ML\s*\(?\s*2024\.08\.16/, /模擬試題/, /商研院/];

describe('題庫結構完整性', () => {
  it('題庫非空', () => {
    expect(ALL.length).toBeGreaterThan(0);
  });

  it('每題恰好 4 個選項，key 為 A/B/C/D 且不重複', () => {
    const bad = ALL.filter((it) => {
      const keys = it.options.map((o) => o.key);
      return keys.length !== 4 || keys.join('') !== 'ABCD';
    }).map((it) => `${who(it)}: [${it.options.map((o) => o.key).join(',')}]`);
    expect(bad).toEqual([]);
  });

  it('answer 必須是選項 key 之一', () => {
    const bad = ALL.filter((it) => it.answer && !it.options.some((o) => o.key === it.answer)).map(
      (it) => `${who(it)}: answer=${it.answer}`
    );
    expect(bad).toEqual([]);
  });

  it('題幹與選項不得含換行（雙欄擷取殘留）', () => {
    const bad = ALL.filter((it) =>
      [it.stem, ...it.options.map((o) => o.text)].some((t) => t.includes('\n'))
    ).map(who);
    expect(bad).toEqual([]);
  });

  it('題幹與選項不得含 PDF 頁首頁尾', () => {
    const bad = ALL.filter((it) =>
      [it.stem, ...it.options.map((o) => o.text)].some((t) =>
        PDF_FURNITURE.some((re) => re.test(t))
      )
    ).map(who);
    expect(bad).toEqual([]);
  });

  it('題幹與選項不得為空白', () => {
    const bad = ALL.filter(
      (it) => !it.stem.trim() || it.options.some((o) => !o.text.trim())
    ).map(who);
    expect(bad).toEqual([]);
  });

  // 這條就是坎昆那題漏掉的原因：註記寫了「答案應為 C」，answer 卻還是 D。
  it('有 _correction_note 的題目，必須真的改過答案（prior_answer 存在且與現答案不同）', () => {
    const bad = DS.gist_items
      .filter((it) => it._correction_note)
      .filter((it) => !it.metadata?.prior_answer || it.metadata.prior_answer === it.answer)
      .map((it) => `${who(it)}: answer=${it.answer} prior=${it.metadata?.prior_answer ?? 'MISSING'}`);
    expect(bad).toEqual([]);
  });

  it('meta 統計與實際題數一致', () => {
    expect(DS.meta.total_questions).toBe(ALL.length);
    expect(DS.meta.gist_questions).toBe(DS.gist_items.length);
    expect(DS.meta.our_unique_questions).toBe(DS.our_unique_items.length);
    expect(DS.meta.with_answer).toBe(ALL.filter((it) => it.answer).length);
  });

  it('AR6「次方成長」偽造題不得再出現（issue #85 迴歸防護）', () => {
    const bad = ALL.filter((it) => /次方/.test(it.stem) && /AR6/.test(it.stem)).map(who);
    expect(bad).toEqual([]);
  });

  // quarterly workflow 只 curl「有 source URL」的題目。沒有 URL 的 time_sensitive 題目
  // 對它完全隱形 —— 修正前 569 題裡有 535 題（94%）就是這樣被漏掉的。
  // 標了 time_sensitive 卻沒附來源，等於宣稱「這題會過期」又不給任何方式去驗證。
  //
  // URL 的取法必須和 workflow 的 jq 一致（source.url 或 metadata.sources[] 皆可），
  // 否則這個測試會對「覆蓋率」說謊。
  const sourceUrls = (it: Item): string[] =>
    [it.source?.url, ...(it.metadata?.sources ?? [])].filter(
      (u): u is string => typeof u === 'string' && /^https?:\/\//.test(u)
    );

  it('標為 time_sensitive 的題目必須附來源 URL（否則 quarterly workflow 看不到）', () => {
    const bad = ALL.filter((it) => (it.quality_flags ?? []).includes('time_sensitive'))
      .filter((it) => sourceUrls(it).length === 0)
      .map(who);
    expect(bad).toEqual([]);
  });

  // valid_as_of 是「內容查證到哪一天」，不是「這個檔案何時被改過」。
  // 未重新查證的題目必須誠實沿用它原本的日期 —— 謊報成今天比沒有這個欄位更糟。
  it('time_sensitive 題目應帶 valid_as_of，標示內容查證到哪一天', () => {
    const bad = ALL.filter((it) => (it.quality_flags ?? []).includes('time_sensitive'))
      .filter((it) => !it.metadata?.valid_as_of)
      .map(who);
    expect(bad).toEqual([]);
  });
});
