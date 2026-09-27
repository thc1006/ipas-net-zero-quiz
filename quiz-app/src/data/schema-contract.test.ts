// 題庫格式的「單一契約」—— schemas/*.json 與手寫 validator 不得各說一套。
//
// 為什麼需要這一組：使用者的目標是「別人只要符合 schema 換上題目、改名稱，就變成另一個
// 考古題平台」。要做到那件事，schema 必須是**權威**的；而這個 repo 已經被
// 「同一件事寫兩份、其中一份較寬」咬過四次（解析字母規則、法規別名表各一次，
// 詳見那兩支檔案的註解）。schema 是第三份對「什麼叫合法題目」的描述，
// 所以一開始就把它綁在既有 validator 與真實資料上。
//
// 釘住三件事：
//   1. 現行兩個題庫都通過 schema；
//   2. schema 的列舉值與 TypeScript 常數**完全相同**（不是「看起來一樣」）；
//   3. 同一批刻意做壞的資料，schema 與手寫 validator 必須**都**拒收 ——
//      只要一邊放行，就是契約出現裂縫。
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import poolSchema from '../../../schemas/practice-pool.schema.json';
import mainSchema from '../../../schemas/main-bank.schema.json';
import pool from './practice_pool.json';
import dataset from './integrated_dataset.json';
import { validatePracticePool, SOURCE_TYPES, DIFFICULTIES, VERDICTS } from '../utils/practice-pool-schema';
import { validateMainBank, EXAM_SUBJECTS } from '../utils/main-bank-schema';
import { DATA_QUALITY_FLAGS } from '../types/practicePool';

function buildAjv(): Ajv2020 {
  // strict:false —— 我們在 schema 裡用 description 寫了大量「為什麼」，
  // 且 metadata 刻意開放額外欄位（每輪複核都會加新的稽核鍵）。
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  ajv.addSchema(poolSchema, 'practice-pool.schema.json');
  return ajv;
}

const ajv = buildAjv();
const validatePoolSchema = ajv.compile(poolSchema);
const validateMainSchema = ajv.compile(mainSchema);

/** 深拷貝：mutation 測試不可污染其他測試讀到的 import 物件 */
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('schema 與現行資料', () => {
  it('practice_pool.json 通過 JSON Schema', () => {
    const ok = validatePoolSchema(pool);
    expect(
      ok ? [] : (validatePoolSchema.errors ?? []).slice(0, 5).map((e) => `${e.instancePath} ${e.message}`),
      '練習池不符 schema'
    ).toEqual([]);
  });

  it('integrated_dataset.json 通過 JSON Schema', () => {
    const ok = validateMainSchema(dataset);
    expect(
      ok ? [] : (validateMainSchema.errors ?? []).slice(0, 5).map((e) => `${e.instancePath} ${e.message}`),
      '主題庫不符 schema'
    ).toEqual([]);
  });

  it('母體夠大（這組 gate 不能空轉）', () => {
    expect((pool as { items: unknown[] }).items.length).toBeGreaterThan(100);
    expect((dataset as { gist_items: unknown[] }).gist_items.length).toBeGreaterThan(400);
  });
});

describe('schema 的列舉值必須與 TypeScript 常數完全相同', () => {
  const defOf = (s: unknown, name: string): string[] =>
    ((s as { $defs: Record<string, { enum?: string[] }> }).$defs[name].enum ?? []);

  it('qualityFlag == DATA_QUALITY_FLAGS', () => {
    expect([...defOf(poolSchema, 'qualityFlag')].sort()).toEqual([...DATA_QUALITY_FLAGS].sort());
  });
  it('sourceType == SOURCE_TYPES', () => {
    expect([...defOf(poolSchema, 'sourceType')].sort()).toEqual([...SOURCE_TYPES].sort());
  });
  it('difficulty == DIFFICULTIES', () => {
    expect([...defOf(poolSchema, 'difficulty')].sort()).toEqual([...DIFFICULTIES].sort());
  });
  it('verdict == VERDICTS', () => {
    expect([...defOf(poolSchema, 'verdict')].sort()).toEqual([...VERDICTS].sort());
  });
  it('examSubject == EXAM_SUBJECTS（換考科平台主要就是改這兩處，必須同步）', () => {
    expect([...defOf(mainSchema, 'examSubject')].sort()).toEqual([...EXAM_SUBJECTS].sort());
  });
});

describe('同一批壞資料，schema 與手寫 validator 必須都拒收', () => {
  type PoolDoc = { items: Record<string, unknown>[] };
  const breakages: ReadonlyArray<{ what: string; mutate: (d: PoolDoc) => void }> = [
    { what: '缺 id', mutate: (d) => delete d.items[0].id },
    { what: '缺 stem', mutate: (d) => delete d.items[0].stem },
    { what: 'options 為空陣列', mutate: (d) => { d.items[0].options = []; } },
    { what: 'answer 是數字', mutate: (d) => { d.items[0].answer = 3; } },
    { what: 'explanation 是 null', mutate: (d) => { d.items[0].explanation = null; } },
    { what: 'topic_tags 混入數字', mutate: (d) => { d.items[0].topic_tags = ['a', 1]; } },
    { what: 'difficulty 不在列舉內', mutate: (d) => { d.items[0].difficulty = 'insane'; } },
    { what: 'quality_flags 出現未知旗標', mutate: (d) => { d.items[0].quality_flags = ['typo_flag']; } },
    { what: 'provenance 不見了', mutate: (d) => { delete d.items[0].provenance; } },
    {
      what: 'source_type 不在列舉內',
      mutate: (d) => { (d.items[0].provenance as Record<string, unknown>).source_type = 'guessed'; },
    },
    {
      what: 'verify_verdict 不在列舉內',
      mutate: (d) => { (d.items[0].provenance as Record<string, unknown>).verify_verdict = 'PROBABLY'; },
    },
    {
      what: 'ai_generated 卻沒有 ai_metadata',
      mutate: (d) => {
        const p = d.items[0].provenance as Record<string, unknown>;
        p.source_type = 'ai_generated';
        delete p.ai_metadata;
      },
    },
    {
      what: 'verified_date 是空字串',
      mutate: (d) => { (d.items[0].provenance as Record<string, unknown>).verified_date = ''; },
    },
  ];

  it.each(breakages.map((b) => [b.what, b.mutate] as const))(
    '%s —— 兩邊都要擋',
    (what, mutate) => {
      const doc = clone(pool) as unknown as PoolDoc;
      mutate(doc);
      const schemaOk = validatePoolSchema(doc);
      const validatorErrs = validatePracticePool(doc);
      expect(schemaOk, `${what}：JSON Schema 放行了`).toBe(false);
      expect(
        validatorErrs.length,
        `${what}：手寫 validator 放行了 —— 兩份契約已經裂開`
      ).toBeGreaterThan(0);
    }
  );

  it('主題庫：exam_subject 不在列舉內，schema 與 validator 都要擋', () => {
    const doc = clone(dataset) as unknown as { gist_items: Record<string, unknown>[] };
    doc.gist_items[0].exam_subject = '考科9';
    expect(validateMainSchema(doc), 'JSON Schema 放行了').toBe(false);
    expect(validateMainBank(doc).length, '手寫 validator 放行了').toBeGreaterThan(0);
  });

  const officialBreakages: ReadonlyArray<readonly [string, (o: Record<string, unknown>) => void]> = [
    ['session 不是「115-01」這種格式', (o) => { o.session = '115/1'; }],
    ['session 的梯次是 00（梯次從 01 起算）', (o) => { o.session = '115-00'; }],
    ['exam_date 不是 YYYY-MM-DD', (o) => { o.exam_date = '115 年 5 月 16 日'; }],
    ['subject 不是「L11」這種格式', (o) => { o.subject = '第一科'; }],
    ['question_number 是 0', (o) => { o.question_number = 0; }],
    ['question_number 是字串', (o) => { o.question_number = '1'; }],
    ['缺 question_number', (o) => { delete o.question_number; }],
    ['缺 session', (o) => { delete o.session; }],
    ['缺 exam_date', (o) => { delete o.exam_date; }],
    ['缺 subject', (o) => { delete o.subject; }],
    ['question_number 是小數', (o) => { o.question_number = 1.5; }],
    ['subject 是三位數', (o) => { o.subject = 'L111'; }],
    ['多出不認得的欄位', (o) => { o.answer = 'C'; }],
  ];

  it.each(officialBreakages)('主題庫：official_exam 的%s —— 兩邊都要擋', (what, mutate) => {
    const doc = clone(dataset) as unknown as { our_unique_items: Record<string, unknown>[] };
    const item = doc.our_unique_items.find((i) => i.official_exam);
    expect(item, '題庫裡沒有任何官方公告試題 —— 這組案例在空轉').toBeDefined();
    mutate(item!.official_exam as Record<string, unknown>);
    expect(validateMainSchema(doc), `${what}：JSON Schema 放行了`).toBe(false);
    expect(validateMainBank(doc).length, `${what}：手寫 validator 放行了`).toBeGreaterThan(0);
  });

  // official_exam 整個不是物件：上面的案例都是改物件裡的欄位，走不到 validator「不是物件」那一條。null 以外的四種，
  // 拿掉那一條照樣會被擋（缺 session 等四個欄位；字串與陣列另外還會被當成不認得的欄位），所以比的是那一條自己的訊息。
  // 數字與布林：schema 放寬成也收它們，只有前三種的時候照樣全綠（第十九輪確認審查實測）
  const officialNotObjects: ReadonlyArray<readonly [string, unknown]> = [
    ['null', null],
    ['字串', '115-01'],
    ['陣列', ['115-01', '2026-05-16', 'L11', 1]],
    ['數字', 1],
    ['布林', true],
  ];

  it.each(officialNotObjects)('主題庫：official_exam 是%s（不是物件）—— 兩邊都要擋', (what, value) => {
    const doc = clone(dataset) as unknown as { our_unique_items: Record<string, unknown>[] };
    const index = doc.our_unique_items.findIndex((i) => i.official_exam);
    expect(index, '題庫裡沒有任何官方公告試題 —— 這組案例在空轉').toBeGreaterThanOrEqual(0);
    doc.our_unique_items[index].official_exam = value;
    expect(validateMainSchema(doc), `${what}：JSON Schema 放行了`).toBe(false);
    expect(validateMainBank(doc), `${what}：手寫 validator 沒有說它不是物件`).toContainEqual({
      path: `our_unique_items[${index}].official_exam`,
      message: 'must be object',
    });
  });

  it('沒有做壞的原始資料，兩邊都要放行（確認上面不是「什麼都擋」）', () => {
    expect(validatePoolSchema(clone(pool))).toBe(true);
    expect(validatePracticePool(clone(pool))).toEqual([]);
  });
});
