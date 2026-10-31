// 官方公告試題在畫面上的稱呼：題卡上的標籤、題目在 PDF 上的位置。
import { describe, it, expect } from 'vitest';
import datasetRaw from '../data/integrated_dataset.json';
import type { UniqueQuestion } from '../types/quiz';
import {
  officialExamLabel,
  officialExamPlace,
  officialExamReference,
  officialSampleLabel,
  officialSampleReference,
  sampleEditionLabel,
} from './official-exam';

const exam = { session: '115-01', exam_date: '2026-05-16', subject: 'L11', question_number: 5 };

describe('官方公告試題的標籤', () => {
  it('標籤寫出是哪一次的官方公告試題', () => {
    expect(officialExamLabel(exam)).toBe('115 年第一次官方公告試題');
    expect(officialExamLabel({ ...exam, session: '115-02' })).toBe('115 年第二次官方公告試題');
    expect(officialExamLabel({ ...exam, session: '115-10' })).toBe('115 年第十次官方公告試題');
  });

  it('梯次超過十次也說得出來，不會印成 undefined', () => {
    expect(officialExamLabel({ ...exam, session: '116-11' })).toBe('116 年第 11 次官方公告試題');
  });

  it('題目在 PDF 上的位置：科目與題號', () => {
    expect(officialExamPlace(exam)).toBe('第一科第 5 題');
    expect(officialExamPlace({ ...exam, subject: 'L12', question_number: 40 })).toBe(
      '第二科第 40 題'
    );
  });

  it('不認得的科目代號照原樣寫出來', () => {
    expect(officialExamPlace({ ...exam, subject: 'L21' })).toBe('L21 第 5 題');
  });

  it('完整出處：場次、科目、題號', () => {
    expect(officialExamReference(exam)).toBe('115 年第一次公告試題第一科第 5 題');
  });
});

// 匯入工具（tools/import_official_exam.py）用自己的一份詞彙寫出每一題官方引文的 note：
// 「115 年第一次公告試題第一科第 1 題：PDF 的答案欄印 C。」兩份詞彙必須一致，否則畫面與資料
// 會用兩種說法指同一題 —— 用題庫裡的每一題對帳（任一邊改了科目名稱或序數，這裡就轉紅）。
describe('畫面的稱呼與匯入工具寫進資料的 note 一致', () => {
  const official = (
    datasetRaw as unknown as { our_unique_items: UniqueQuestion[] }
  ).our_unique_items.filter((it) => it.official_exam);

  it('每一題官方公告試題的 note 都是「出處：PDF 的答案欄印 X。」', () => {
    expect(official.length, '題庫裡沒有官方公告試題 —— 這條測試在空轉').toBeGreaterThan(0);
    const bad = official
      .filter((it) => {
        const note = (it.metadata?.evidence ?? []).find(
          (e) => e.generated_by === 'tools/import_official_exam.py' && e.url === it.source?.url
        )?.note;
        return (
          note !== `${officialExamReference(it.official_exam!)}：PDF 的答案欄印 ${it.answer}。`
        );
      })
      .map((it) => it.item_id);
    expect(bad).toEqual([]);
  });
});

describe('參考樣題的稱呼', () => {
  const sample = { edition: '114', subject: 'L12', question_number: 4 };

  it('題卡上的標籤寫出是哪一版的官方參考樣題', () => {
    expect(officialSampleLabel(sample)).toBe('官方參考樣題（114 年版）');
    expect(sampleEditionLabel('115')).toBe('參考樣題（115 年版）');
  });

  it('完整出處：版次、科目、題號（科目與題號的說法與公告試題相同）', () => {
    expect(officialSampleReference(sample)).toBe('參考樣題（114 年版）第二科第 4 題');
    expect(officialSampleReference({ ...sample, subject: 'L21' })).toBe('參考樣題（114 年版）L21 第 4 題');
  });
});

// 參考樣題的匯入工具（tools/import_official_sample.py）也用自己的一份詞彙寫 note：
// 「參考樣題（114 年版）第一科第 1 題：PDF 印「解答：(C)」。」用題庫裡的每一題對帳（主庫配對的那一題也是）
describe('畫面的稱呼與參考樣題匯入工具寫進資料的 note 一致', () => {
  const ds = datasetRaw as unknown as {
    our_unique_items: UniqueQuestion[];
    gist_items: { official_sample?: UniqueQuestion['official_sample']; answer?: string; metadata?: UniqueQuestion['metadata'] }[];
  };
  const samples = [...ds.gist_items, ...ds.our_unique_items].filter((it) => it.official_sample);

  it('每一題參考樣題的 note 都是「出處：PDF 印「解答：(X)」。」', () => {
    expect(samples.length, '題庫裡沒有參考樣題：這條測試在空轉').toBeGreaterThan(0);
    const bad = samples.filter((it) => {
      const note = (it.metadata?.evidence ?? []).find((e) => e.generated_by === 'tools/import_official_sample.py')?.note;
      return note !== `${officialSampleReference(it.official_sample!)}：PDF 印「解答：(${it.answer})」。`;
    });
    expect(bad).toEqual([]);
  });
});
