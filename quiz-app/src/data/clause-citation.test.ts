// 題幹指名條號，就必須拿得出那條的逐字依據。
//
// 起因：`pool-em-ipas_vocus_mock-054` 的題幹寫「依 ISO 14064-1:2018 §6.4」，但整題沒有任何
// 逐字引文能釘住該條號 —— 考生會把一個沒人查證過的條號背起來。ISO／IFRS 是付費或第三方版權
// 文件，不能由二手教材推定條號。
//
// 兩條合法的依據路徑：
//   1. metadata.evidence 裡有逐字引文（一手來源，manifest 有對帳）；
//   2. 解析裡有「」括起來的條文原文 —— 那條路徑由 law-quote-integrity.test.ts
//      逐字比對已釘住的法規全文（sha256 監控），是真的查得到的。
// 兩條都沒有，就不該在題幹指名條號；改成敘述性引述即可，所考的概念不變。
import { describe, it, expect } from 'vitest';
import dataset from './integrated_dataset.json';
import pool from './practice_pool.json';

interface Item {
  index?: number;
  item_id?: string;
  id?: string;
  stem: string;
  explanation?: string | null;
  metadata?: { evidence?: { quote?: string }[] };
}

const ds = dataset as unknown as { gist_items: Item[]; our_unique_items: Item[] };
const pp = pool as unknown as { items: Item[] };
const ALL: Item[] = [...ds.gist_items, ...ds.our_unique_items, ...pp.items];
const who = (it: Item) => it.item_id ?? it.id ?? `gist-${it.index}`;

// §6.4 / 第 7 條 / ¶17 / Article 6 / Annex III
const CLAUSE = /§\s*\d|第\s*\d+\s*[條項款]|¶\s*\d|Article\s*\d|Annex\s+[IVX]/;
// 解析裡「」括起來、長度足以構成條文片段的引用
const LAW_QUOTE = /「[^」]{12,}」/;

const hasEvidenceQuote = (it: Item) =>
  (it.metadata?.evidence ?? []).some((e) => (e.quote ?? '').trim().length > 0);
const hasLawQuote = (it: Item) => LAW_QUOTE.test(it.explanation ?? '');

describe('題幹指名條號者，必須有逐字依據', () => {
  const cited = ALL.filter((it) => CLAUSE.test(it.stem));

  it('這條 gate 不能空轉：題庫裡確實有指名條號的題目', () => {
    expect(cited.length).toBeGreaterThan(20);
  });

  it('每一題指名的條號，都要有 evidence 引文或已釘住的條文原文', () => {
    const unbacked = cited
      .filter((it) => !hasEvidenceQuote(it) && !hasLawQuote(it))
      .map((it) => `${who(it)}: ${it.stem.slice(0, 40)}`);
    expect(
      unbacked,
      '這些題目在題幹指名了條號，卻拿不出任何逐字依據。' +
        '請補一手引文，或把條號改成敘述性引述（概念不變、不必背一個沒人查證過的條號）'
    ).toEqual([]);
  });
});
