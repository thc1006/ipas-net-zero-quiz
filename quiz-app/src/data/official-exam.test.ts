// 官方公告試題：題庫裡帶 official_exam 的題目，必須與還原憑證（restoration-manifest.json）逐題對得上。
//
// official_exam 是給使用者看的標記（「115 年第一次官方公告試題」）。它一旦寫錯 —— 題號對不上、
// 答案被改過、場次標錯 —— 使用者就會把一題「不是官方的答案」當成官方答案背下來。
// 所以標記本身不算數，要能對回 manifest：那裡記著 PDF 的 sha256、題號、PDF 答案欄印的答案，
// 而且是由 tools/import_official_exam.py 與 tools/restore_from_source_pdf.py 從 PDF 產生的。
import { describe, it, expect } from 'vitest';
import datasetRaw from './integrated_dataset.json';
import manifestRaw from './restoration-manifest.json';
import poolRaw from './practice_pool.json';
import type { OfficialExam, UniqueQuestion } from '../types/quiz';

const DS = datasetRaw as unknown as {
  our_unique_items: UniqueQuestion[];
  gist_items: Record<string, unknown>[];
};
const UNIQUE = DS.our_unique_items;
const POOL = (poolRaw as unknown as { items: Record<string, unknown>[] }).items;
const MAN = manifestRaw as unknown as {
  _meta: {
    sources: Record<
      string,
      { url: string; kind?: string; session?: string; exam_date?: string; subject?: string }
    >;
  };
  entries: {
    item_id: string;
    source_id: string;
    source_question_number: number;
    answer_key: string;
    answer_override: unknown;
    dataset_answer: string | null;
  }[];
  dispositions: {
    source_id: string;
    source_question_number: number;
    status: string;
    item_id?: string;
  }[];
};

const OFFICIAL = UNIQUE.filter((it) => it.official_exam);
// 工具建出來的官方引文：帶匯入工具的標記、網址是這一題自己的官方 PDF。人工另外引同一份 PDF 的
// （例如首頁那句但書）沒有標記，匯入工具重新匯入時會保留它 —— 所以不能只看網址。
const GENERATED_BY = 'tools/import_official_exam.py';
const officialEvidence = (it: UniqueQuestion) =>
  (it.metadata?.evidence ?? []).filter(
    (e) => e.generated_by === GENERATED_BY && e.url === it.source?.url
  );
const OFFICIAL_SOURCES = Object.entries(MAN._meta.sources).filter(
  ([, s]) => s.kind === 'official_exam'
);
const ENTRY = new Map(MAN.entries.map((e) => [e.item_id, e]));
const sourceIdOf = (o: OfficialExam) => `S_IPAS_${o.session.replace('-', '_')}_${o.subject}`;

describe('官方公告試題的標記必須對得回 PDF', () => {
  it('這道 gate 不能空轉：題庫裡確實有官方公告試題，manifest 裡也有官方來源', () => {
    expect(OFFICIAL.length).toBeGreaterThan(0);
    expect(OFFICIAL_SOURCES.length).toBeGreaterThan(0);
  });

  // 下面每一條都只看 our_unique_items —— 所以標記出現在別處時，必須在這裡就轉紅，
  // 不能因為「不在檢查範圍」而安靜通過（#128 的官方題模式會讀這個標記）。
  it('只有主題庫的 our_unique_items 可以帶 official_exam（gist 與練習池的題目不是從官方 PDF 匯入的）', () => {
    const bad = [
      ...DS.gist_items.filter((g) => 'official_exam' in g).map((g) => `gist[${String(g.index)}]`),
      ...POOL.filter((p) => 'official_exam' in p).map((p) => `練習池 ${String(p.id)}`),
    ];
    expect(bad).toEqual([]);
  });

  it('出處是 iPAS 官方，年份是考試那一年', () => {
    const bad = OFFICIAL.filter(
      (it) =>
        it.source?.authority !== 'official' ||
        it.source?.publisher !== 'iPAS' ||
        it.year !== Number(it.official_exam!.exam_date.slice(0, 4))
    ).map((it) => it.item_id);
    expect(bad).toEqual([]);
  });

  it('item_id 與來源代號由場次、科目、題號決定（S_IPAS_115_01_L11-q001）', () => {
    const bad = OFFICIAL.filter((it) => {
      const o = it.official_exam!;
      const src = sourceIdOf(o);
      return (
        it.item_id !== `${src}-q${String(o.question_number).padStart(3, '0')}` ||
        it.source?.source_id !== src
      );
    }).map((it) => it.item_id);
    expect(bad).toEqual([]);
  });

  it('每一題的場次、考試日期、科目都與 manifest 登記的官方來源相同', () => {
    const bad = OFFICIAL.filter((it) => {
      const o = it.official_exam!;
      const s = MAN._meta.sources[sourceIdOf(o)];
      return (
        !s ||
        s.kind !== 'official_exam' ||
        s.session !== o.session ||
        s.exam_date !== o.exam_date ||
        s.subject !== o.subject ||
        it.source?.url !== s.url
      );
    }).map((it) => it.item_id);
    expect(bad).toEqual([]);
  });

  it('題號與答案必須等於 PDF：manifest 記的題號、答案欄，而且沒有任何答案更正', () => {
    const bad = OFFICIAL.filter((it) => {
      const e = ENTRY.get(it.item_id);
      return (
        !e ||
        e.source_question_number !== it.official_exam!.question_number ||
        e.answer_key !== it.answer ||
        e.dataset_answer !== it.answer ||
        e.answer_override !== null
      );
    }).map((it) => it.item_id);
    expect(bad, '官方公告試題的答案只能是 PDF 答案欄印的那一個').toEqual([]);
  });

  it('官方來源的每一題都在題庫裡，而且都帶著 official_exam（反過來也成立）', () => {
    for (const [src] of OFFICIAL_SOURCES) {
      const expected = MAN.dispositions
        .filter((d) => d.source_id === src)
        .map((d) => ({ status: d.status, item_id: d.item_id }));
      const inBank = OFFICIAL.filter((it) => it.source?.source_id === src)
        .map((it) => it.item_id)
        .sort();
      expect(
        expected.every((d) => d.status === 'imported'),
        `${src} 有題目沒有匯入`
      ).toBe(true);
      expect(inBank, `${src} 的題目在題庫裡少了或多了`).toEqual(
        expected.map((d) => d.item_id!).sort()
      );
    }
    const unmarked = UNIQUE.filter(
      (it) => OFFICIAL_SOURCES.some(([src]) => it.source?.source_id === src) && !it.official_exam
    ).map((it) => it.item_id);
    expect(unmarked, '來自官方來源、卻沒有標 official_exam').toEqual([]);
  });

  // 專案所有者的決定（2026-09-27）：PDF 首頁註明「試題參考答案以該次考試公告時之法規內容為準」，
  // 所以每一題都標時效，查證日期就是考試日期。它們永遠不算「本輪已重查」（valid_as_of 是考試日期，
  // 不是我們重查的日期），標了時效就算進積欠（content_review 的 carried_over_count）；
  // 目前沒有工具會依 valid_as_of 自動重查，要靠人。
  it('每一題都標時效，valid_as_of 就是考試日期', () => {
    const bad = OFFICIAL.filter(
      (it) =>
        !(it.quality_flags ?? []).includes('time_sensitive') ||
        it.metadata?.valid_as_of !== it.official_exam!.exam_date
    ).map((it) => it.item_id);
    expect(bad).toEqual([]);
  });

  it('每一題都附上官方 PDF 的引文（工具建的恰好一則），而且它支持的正是官方答案', () => {
    const bad = OFFICIAL.filter((it) => {
      const official = officialEvidence(it);
      return official.length !== 1 || official[0].supports_option !== it.answer;
    }).map((it) => it.item_id);
    expect(bad).toEqual([]);
  });

  it('人工另外引的同一份 PDF 不算官方引文；帶標記的才算', () => {
    const base = JSON.parse(JSON.stringify(OFFICIAL[0])) as UniqueQuestion;
    const evidence = base.metadata!.evidence!;
    const human = {
      url: base.source!.url,
      quote: '試題參考答案以該次考試公告時之法規內容為準',
      supports_option: base.answer!,
    };
    const withHuman = { ...base, metadata: { ...base.metadata, evidence: [...evidence, human] } };
    expect(officialEvidence(withHuman)).toEqual(officialEvidence(base));
    expect(officialEvidence(base)).toHaveLength(1);
    const copied = { ...officialEvidence(base)[0], quote: '被複製、改過的官方引文' };
    const twice = { ...base, metadata: { ...base.metadata, evidence: [...evidence, copied] } };
    expect(officialEvidence(twice)).toHaveLength(2);
  });

  // 官方引文就是 PDF 上印的這一題：題幹，下一行接四個選項（PDF 以「；」分隔）；
  // note 寫明題號與答案欄印的字母。引文被換成別題、少了選項、note 寫錯答案，這裡都會轉紅。
  it('官方引文正是 PDF 上印的這一題，note 寫的是這一題的題號與答案欄', () => {
    const printed = (it: UniqueQuestion) =>
      `${it.stem}\n${it.options.map((o) => `(${o.key})${o.text}`).join('；')}`;
    const bad = OFFICIAL.filter((it) => {
      const e = officialEvidence(it)[0];
      const n = it.official_exam!.question_number;
      return (
        !e ||
        e.quote !== printed(it) ||
        !e.note?.endsWith(`第 ${n} 題：PDF 的答案欄印 ${it.answer}。`)
      );
    }).map((it) => it.item_id);
    expect(bad).toEqual([]);
  });
});
