// 還原憑證（restoration manifest）—— 讓「159 題都正確還原」這個宣稱可以被獨立驗證。
//
// 問題：repo 裡原本的測試只驗「總題數對不對、選項結構對不對、答案字母在不在選項裡」。
// 這些都證明不了「每一道還原題確實對應到來源 PDF 的哪一頁、哪一欄、第幾題、
// answer key 是什麼」。也就是說，那個宣稱光看 repo 內容是無法重現的。
//
// manifest 固定了這條證據鏈：
//   item_id -> source_document(+sha256) / page / column / question_no / answer_key
//              + pdf_text_sha256（PDF 裡的文字） + dataset_text_sha256（repo 裡的文字）
//
// 兩個 hash 必須分開記，否則就是自己驗自己 —— 只記一個（而且從 dataset 算）的話，
// 驗證等於拿 dataset-hash 比 dataset-hash，永遠相等。
//
// 分工：
//   CI（這支測試）    不下載 PDF。只驗 manifest ↔ dataset 一致 —— 有人偷改還原題的文字，
//                     dataset_text_sha256 就對不上，當場被抓。離線、秒級。
//   人工（可重現）    `python tools/restore_from_source_pdf.py --verify`
//                     會重新下載 PDF、比對 sha256、重跑分欄擷取，逐題核對頁碼／欄位／
//                     題號／answer key／文字。實測 159/159 相符。
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import datasetRaw from './integrated_dataset.json';
import manifestRaw from './restoration-manifest.json';

interface Opt {
  key: string;
  text: string;
}
interface DsItem {
  item_id: string;
  stem: string;
  options: Opt[];
  answer?: string | null;
  exam_subject?: string;
  source?: { source_id?: string };
}
interface Entry {
  item_id: string;
  source_id: string;
  source_document: string;
  source_sha256: string;
  page: number;
  column: 'left' | 'right';
  source_question_number: number;
  answer_key: string;
  pdf_text_sha256: string;
  dataset_text_sha256: string;
  matches_source: boolean;
  dataset_answer: string | null;
}

const DS = datasetRaw as unknown as { our_unique_items: DsItem[] };
const MAN = manifestRaw as unknown as {
  _meta: { restored_count: number; sources: Record<string, { sha256: string; exam_subject: string }> };
  entries: Entry[];
};

// 必須與 tools/restore_from_source_pdf.py 的 normalized_text_sha256() 完全一致：
// 空白全剝掉，選項依 key 排序 —— 只認內容，不認排版。
const textHash = (stem: string, options: Opt[]): string => {
  const payload =
    stem.replace(/\s+/g, '') +
    '||' +
    [...options]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((o) => `${o.key}:${o.text.replace(/[ \t\r\n]+/g, '')}`)
      .join('|');
  return createHash('sha256').update(payload, 'utf8').digest('hex');
};

const RESTORED = DS.our_unique_items.filter((i) =>
  (i.source?.source_id ?? '').startsWith('S_CHU')
);
const BY_ID = new Map(MAN.entries.map((e) => [e.item_id, e]));

describe('restoration manifest', () => {
  it('manifest 與 dataset 的還原題一一對應', () => {
    const dsIds = RESTORED.map((i) => i.item_id).sort();
    const manIds = MAN.entries.map((e) => e.item_id).sort();
    expect(manIds).toEqual(dsIds);
    expect(MAN._meta.restored_count).toBe(MAN.entries.length);
    expect(MAN.entries.length).toBeGreaterThan(0);
  });

  // 防竄改的核心：有人偷改還原題的文字，這條就會掛。
  it('每題的 dataset_text_sha256 必須等於 repo 裡「現在」的文字 hash', () => {
    const bad = RESTORED.filter((it) => {
      const e = BY_ID.get(it.item_id);
      return !e || e.dataset_text_sha256 !== textHash(it.stem, it.options);
    }).map((it) => it.item_id);
    expect(
      bad,
      `這些還原題的文字已被改動，但 manifest 沒有同步更新。\n` +
        `若是刻意修改，請重跑：python tools/restore_from_source_pdf.py --emit\n` +
        `（該指令會重新下載 PDF 並比對，確保修改是有憑據的）\n${bad.join('\n')}`
    ).toEqual([]);
  });

  // 這一條是「repo 內容 == 來源 PDF 內容」的宣稱本身。
  // --emit 時由 tools 腳本實際比對 PDF 後寫入；這裡把它釘住，不允許偷偷改成 false。
  it('每題都必須標記 matches_source=true（repo 文字 == PDF 文字）', () => {
    const bad = MAN.entries.filter((e) => !e.matches_source).map((e) => e.item_id);
    expect(bad).toEqual([]);
  });

  it('每題的 answer 必須等於 PDF 自己印的 answer key', () => {
    const bad = RESTORED.filter((it) => {
      const e = BY_ID.get(it.item_id);
      return !e || e.answer_key !== it.answer || e.dataset_answer !== it.answer;
    }).map((it) => `${it.item_id}: dataset=${it.answer} manifest_key=${BY_ID.get(it.item_id)?.answer_key}`);
    expect(bad).toEqual([]);
  });

  it('每題都要有可追溯的來源座標（PDF sha256 / 頁碼 / 欄位 / 題號）', () => {
    const bad = MAN.entries.filter(
      (e) =>
        !/^[0-9a-f]{64}$/.test(e.source_sha256) ||
        !/^https?:\/\//.test(e.source_document) ||
        !Number.isInteger(e.page) ||
        e.page < 1 ||
        (e.column !== 'left' && e.column !== 'right') ||
        !Number.isInteger(e.source_question_number) ||
        e.source_question_number < 1 ||
        !/^[A-D]$/.test(e.answer_key) ||
        !/^[0-9a-f]{64}$/.test(e.pdf_text_sha256)
    ).map((e) => e.item_id);
    expect(bad).toEqual([]);
  });

  it('同一份 PDF 的同一題號不得對應到兩個 item', () => {
    const seen = new Map<string, string[]>();
    for (const e of MAN.entries) {
      const k = `${e.source_id}#${e.source_question_number}`;
      seen.set(k, [...(seen.get(k) ?? []), e.item_id]);
    }
    const dups = [...seen.entries()].filter(([, v]) => v.length > 1);
    expect(dups).toEqual([]);
  });

  it('item_id 必須與來源座標一致（S_CHU_06-q037 ⇔ S_CHU_06 第 37 題）', () => {
    const bad = MAN.entries.filter(
      (e) => e.item_id !== `${e.source_id}-q${String(e.source_question_number).padStart(3, '0')}`
    ).map((e) => e.item_id);
    expect(bad).toEqual([]);
  });

  it('exam_subject 必須與來源 PDF 的考科一致', () => {
    const bad = RESTORED.filter((it) => {
      const e = BY_ID.get(it.item_id);
      if (!e) return true;
      return it.exam_subject !== MAN._meta.sources[e.source_id]?.exam_subject;
    }).map((it) => it.item_id);
    expect(bad).toEqual([]);
  });

  it('左右欄都有題目 —— 分欄擷取確實有效（否則等於整份只讀了一欄）', () => {
    const left = MAN.entries.filter((e) => e.column === 'left').length;
    const right = MAN.entries.filter((e) => e.column === 'right').length;
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
  });
});
