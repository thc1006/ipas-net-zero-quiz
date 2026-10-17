// 參考樣題：題庫裡帶 official_sample 的題目，必須與還原憑證（restoration-manifest.json）逐題對得上。
//
// official_sample 是給使用者看的標記（「官方參考樣題（114 年版）」），也決定「只出官方題目」抽得到哪些題。
// 它一旦寫錯（題號對不上、答案被改過、版次標錯、標在不是參考樣題的題目上），使用者就會把一題「不是官方的答案」
// 當成官方答案背下來。所以標記本身不算數，要能對回 manifest：那裡記著 PDF 的 sha256、題號、PDF 印的「解答」，
// 而且是由 tools/import_official_sample.py 與 tools/restore_from_source_pdf.py 從 PDF 產生的。
// 公告試題的同一套檢查在 official-exam.test.ts。
import { describe, it, expect } from 'vitest';
import datasetRaw from './integrated_dataset.json';
import manifestRaw from './restoration-manifest.json';
import poolRaw from './practice_pool.json';
import type { OfficialSample, UniqueQuestion } from '../types/quiz';

interface Marked {
  ref: string;
  answer?: string | null;
  exam_subject?: string;
  options?: { key: string; text: string }[];
  stem?: string;
  official_sample?: OfficialSample;
  official_exam?: unknown;
  metadata?: UniqueQuestion['metadata'];
  source?: unknown;
}

const DS = datasetRaw as unknown as {
  our_unique_items: UniqueQuestion[];
  gist_items: (Record<string, unknown> & { index: number })[];
};
const UNIQUE = DS.our_unique_items;
const POOL = (poolRaw as unknown as { items: Record<string, unknown>[] }).items;
const MAN = manifestRaw as unknown as {
  _meta: {
    sources: Record<string, { url: string; kind?: string; edition?: string; subject?: string; exam_subject?: string }>;
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
    duplicate_of?: { dataset_item: string };
    source_answer_key?: string;
  }[];
};

// 主庫的稱呼與 manifest 相同：題庫題用 item_id，gist 題寫成 gist_items[N]
const ALL: Marked[] = [
  ...DS.gist_items.map((g) => ({ ...(g as object), ref: `gist_items[${g.index}]` }) as Marked),
  ...UNIQUE.map((u) => ({ ...(u as object), ref: u.item_id }) as Marked),
];
const SAMPLES = UNIQUE.filter((it) => it.official_sample);
const MARKED = ALL.filter((it) => it.official_sample);
const SAMPLE_SOURCES = Object.entries(MAN._meta.sources).filter(([, s]) => s.kind === 'official_sample');
const ENTRY = new Map(MAN.entries.map((e) => [e.item_id, e]));
const GENERATED_BY = 'tools/import_official_sample.py';
const sampleEvidence = (it: Marked) =>
  (it.metadata?.evidence ?? []).filter((e) => e.generated_by === GENERATED_BY);
const sourceIdOf = (o: OfficialSample) => `S_IPAS_SAMPLE_${o.edition}_${o.subject}`;
const SUBJECT_NAME: Record<string, string> = { L11: '第一科', L12: '第二科' };

describe('參考樣題的標記必須對得回 PDF', () => {
  it('這道 gate 不能空轉：題庫裡有匯入的參考樣題、也有主庫配對的那一題，manifest 裡有參考樣題的來源', () => {
    expect(SAMPLES.length).toBeGreaterThan(0);
    expect(MARKED.length).toBeGreaterThan(SAMPLES.length);
    expect(SAMPLE_SOURCES.length).toBeGreaterThan(0);
  });

  // 一題只屬於一份官方卷：同時帶兩種標記，原卷順序與題卡上的出處都說不清（utils/question-source.ts 的 paperKey
  // 只看其中一種）。真的遇到同一題既是參考樣題、又是公告試題時，再決定怎麼標
  it('沒有題目同時帶 official_exam 與 official_sample', () => {
    expect(MARKED.filter((it) => it.official_exam).map((it) => it.ref)).toEqual([]);
  });

  it('練習池的題目不帶 official_sample（不是從官方 PDF 匯入的）', () => {
    expect(POOL.filter((p) => 'official_sample' in p).map((p) => String(p.id))).toEqual([]);
  });

  // 帶標記的題目只有兩種：匯入的（manifest 記為 imported），與主庫已有同一題、登記為配對的
  // （duplicate_in_dataset，manifest 記著主庫的哪一題）。多標一題，非官方的題目就混進官方模式
  it('每一題帶標記的題目，在 manifest 裡不是匯入的那一題，就是登記的主庫配對；反過來也成立', () => {
    const expected = new Map<string, string>();
    for (const d of MAN.dispositions) {
      const src = MAN._meta.sources[d.source_id];
      if (src?.kind !== 'official_sample') continue;
      const where = `${d.source_id} 第 ${d.source_question_number} 題`;
      if (d.status === 'imported') expected.set(d.item_id!, where);
      else if (d.status === 'duplicate_in_dataset') expected.set(d.duplicate_of!.dataset_item, where);
      else expected.set(`（${d.status}）`, where);
    }
    expect([...expected.keys()].filter((k) => k.startsWith('（')), '參考樣題有題目沒有匯入、也不是配對').toEqual([]);
    expect(MARKED.map((it) => it.ref).sort()).toEqual([...expected.keys()].sort());
  });

  it('標記的版次、科目、題號，就是 manifest 記的那一份來源的那一題', () => {
    const bad = MARKED.filter((it) => {
      const o = it.official_sample!;
      const src = sourceIdOf(o);
      const d = MAN.dispositions.find(
        (x) =>
          x.source_id === src &&
          x.source_question_number === o.question_number &&
          (x.status === 'imported' ? x.item_id === it.ref : x.duplicate_of?.dataset_item === it.ref)
      );
      const s = MAN._meta.sources[src];
      return !d || s?.kind !== 'official_sample' || s.edition !== o.edition || s.subject !== o.subject;
    }).map((it) => it.ref);
    expect(bad).toEqual([]);
  });

  it('考科與科目代號一致（L11 考科1、L12 考科2），主庫配對的那一題也一樣', () => {
    const bad = MARKED.filter(
      (it) => it.exam_subject !== ({ L11: '考科1', L12: '考科2' } as Record<string, string>)[it.official_sample!.subject]
    ).map((it) => `${it.ref}：${it.exam_subject}／${it.official_sample!.subject}`);
    expect(bad).toEqual([]);
  });

  it('匯入的題目：出處是 iPAS 官方、年份是版次那一年、item_id 與來源代號由版次、科目、題號決定', () => {
    const bad = SAMPLES.filter((it) => {
      const o = it.official_sample!;
      const src = sourceIdOf(o);
      return (
        it.source?.authority !== 'official' ||
        it.source?.publisher !== 'iPAS' ||
        it.source?.source_id !== src ||
        it.source?.url !== MAN._meta.sources[src]?.url ||
        it.year !== Number(o.edition) + 1911 ||
        it.item_id !== `${src}-q${String(o.question_number).padStart(3, '0')}`
      );
    }).map((it) => it.item_id);
    expect(bad).toEqual([]);
  });

  it('題號與答案必須等於 PDF：匯入的看 manifest 的題號與「解答」，沒有任何答案更正；配對的看 manifest 記的解答', () => {
    const bad = MARKED.filter((it) => {
      const o = it.official_sample!;
      const e = ENTRY.get(it.ref);
      if (e) {
        return (
          e.source_question_number !== o.question_number ||
          e.answer_key !== it.answer ||
          e.dataset_answer !== it.answer ||
          e.answer_override !== null
        );
      }
      const d = MAN.dispositions.find((x) => x.duplicate_of?.dataset_item === it.ref);
      return !d || d.source_answer_key !== it.answer;
    }).map((it) => it.ref);
    expect(bad, '參考樣題的答案只能是 PDF 印的那一個').toEqual([]);
  });

  it('每一題都附上參考樣題 PDF 的引文（工具建的恰好一則），排在最前面，支持的正是 PDF 的解答', () => {
    const bad = MARKED.filter((it) => {
      const own = sampleEvidence(it);
      const url = MAN._meta.sources[sourceIdOf(it.official_sample!)]?.url;
      return (
        own.length !== 1 ||
        own[0].supports_option !== it.answer ||
        own[0].url !== url ||
        it.metadata?.evidence?.[0] !== own[0]
      );
    }).map((it) => it.ref);
    expect(bad).toEqual([]);
  });

  // 引文就是 PDF 上印的這一題：題幹，下一行接四個選項（PDF 以「；」分隔），再一行「解答：(X)」；note 寫明
  // 版次、科目、題號與解答。匯入的題目就是照 PDF 寫的，逐字相同；主庫配對的那一題是同一題，但空白可能不同
  // （gist[287] 的 2050 前後是窄的不換行空白），manifest 也是不計空白登記的，所以拿掉空白再比
  it('引文正是 PDF 上印的這一題，note 寫的是這一題的出處與解答', () => {
    const printed = (it: Marked) =>
      `${it.stem}\n${(it.options ?? []).map((o) => `(${o.key})${o.text}`).join('；')}\n解答：(${it.answer})`;
    const squash = (text: string) => text.replace(/\s+/g, '');
    const bad = MARKED.filter((it) => {
      const e = sampleEvidence(it)[0];
      const o = it.official_sample!;
      const place = `參考樣題（${o.edition} 年版）${SUBJECT_NAME[o.subject]}第 ${o.question_number} 題`;
      const same = ENTRY.has(it.ref) ? e?.quote === printed(it) : squash(e?.quote ?? '') === squash(printed(it));
      return !e || !same || e.note !== `${place}：PDF 印「解答：(${it.answer})」。`;
    }).map((it) => it.ref);
    expect(bad).toEqual([]);
  });
});
