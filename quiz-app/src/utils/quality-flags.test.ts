// checkFlags 的規則本身要被測 —— 不是為了覆蓋率數字。
//
// 起因：Codecov 報 quality-flags.ts 只有 61.70%，18 行沒被覆蓋。
// 去看那 18 行是什麼 —— **全部都是 push(...)，也就是「發現違規」的那幾行**。
//
// 意思是：這五條規則從來沒有真正吐出過一筆違規。
// 兩個題庫的資料現在剛好都是乾淨的，所以 gate 一路綠燈 ——
// 但**綠燈的原因是資料乾淨，不是規則有效**。這兩件事必須分開證明。
//
// 「一個抓不到錯的把關，等於沒有把關。」
// 下面每一條測試都餵一筆**故意違規**的資料，證明對應的規則真的會紅。

import { describe, it, expect } from 'vitest';
import {
  checkFlags,
  formatFlagViolations,
  KNOWN_FLAGS,
  type FlaggedItem,
  type FlagCheckOptions,
} from './quality-flags';

/** 一筆乾淨、不觸發任何規則的題目 —— 每個測試只偏離它一個欄位。 */
const clean = (over: Partial<FlaggedItem> = {}): FlaggedItem => ({
  id: 'Q1',
  flags: [],
  sourceUrls: [],
  validAsOf: null,
  priorAnswer: null,
  ...over,
});

const rules = (
  items: FlaggedItem[],
  stableIds?: ReadonlySet<string>,
  opts?: FlagCheckOptions
): string[] => checkFlags(items, stableIds, opts).map((v) => v.rule);

describe('checkFlags —— 每條規則都必須真的抓得到錯', () => {
  it('乾淨的資料不該產生任何違規（否則後面每條測試都是假陽性）', () => {
    expect(checkFlags([clean()])).toEqual([]);
  });

  describe('1) unknown_flag —— 打錯字的 flag 等於沒有 flag', () => {
    it('未知的 flag 會被抓到', () => {
      const v = checkFlags([clean({ flags: ['time_senstive'] })]); // 故意拼錯
      expect(v.map((x) => x.rule)).toContain('unknown_flag');
      expect(v[0].detail).toContain('time_senstive');
    });

    it('KNOWN_FLAGS 裡的每一個都不會被誤報', () => {
      for (const f of KNOWN_FLAGS) {
        // time_sensitive 會觸發別條規則，這裡只確認它不是「未知」
        expect(rules([clean({ flags: [f], sourceUrls: ['https://law.moj.gov.tw/x'], validAsOf: '2026-07-13' })]))
          .not.toContain('unknown_flag');
      }
    });
  });

  describe('2) time_sensitive_without_primary_source', () => {
    it('只有社群站來源的 time_sensitive 題會被抓到', () => {
      const v = checkFlags([
        clean({ flags: ['time_sensitive'], sourceUrls: ['https://vocus.cc/article/xxx'], validAsOf: '2026-07-13' }),
      ]);
      expect(v.map((x) => x.rule)).toContain('time_sensitive_without_primary_source');
      expect(v[0].detail).toContain('vocus.cc');
    });

    it('完全沒有來源的 time_sensitive 題會被抓到，且訊息說得出「無來源」', () => {
      const v = checkFlags([clean({ flags: ['time_sensitive'], validAsOf: '2026-07-13' })]);
      const hit = v.find((x) => x.rule === 'time_sensitive_without_primary_source');
      expect(hit).toBeDefined();
      expect(hit!.detail).toContain('（無來源）');
    });

    it('有一手來源就不會被抓', () => {
      expect(
        rules([
          clean({
            flags: ['time_sensitive'],
            sourceUrls: ['https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=O0020098'],
            validAsOf: '2026-07-13',
          }),
        ])
      ).not.toContain('time_sensitive_without_primary_source');
    });

    it('一手＋社群混在一起，只要有一條一手就算數', () => {
      expect(
        rules([
          clean({
            flags: ['time_sensitive'],
            sourceUrls: ['https://vocus.cc/a', 'https://www.moenv.gov.tw/b'],
            validAsOf: '2026-07-13',
          }),
        ])
      ).not.toContain('time_sensitive_without_primary_source');
    });
  });

  describe('3) time_sensitive_without_valid_as_of', () => {
    it('標了 time_sensitive 卻沒有 valid_as_of 會被抓到', () => {
      expect(
        rules([clean({ flags: ['time_sensitive'], sourceUrls: ['https://law.moj.gov.tw/x'] })])
      ).toContain('time_sensitive_without_valid_as_of');
    });

    it('空字串的 valid_as_of 也算沒有 —— 不能靠塞空字串騙過去', () => {
      expect(
        rules([
          clean({ flags: ['time_sensitive'], sourceUrls: ['https://law.moj.gov.tw/x'], validAsOf: '' }),
        ])
      ).toContain('time_sensitive_without_valid_as_of');
    });
  });

  describe('4) valid_as_of_without_time_sensitive —— 一句假的保證', () => {
    // 這正是 S_VOCUS_03-q004 踩到的：更正後留著 valid_as_of=2026-07-13，
    // 但沒標 time_sensitive → 那個日期看起來像「查證過」，
    // 而季排程只掃 time_sensitive，根本不會再看它一眼。
    it('沒標 time_sensitive 卻有 valid_as_of，在主題庫模式下會被抓到', () => {
      const v = checkFlags([clean({ validAsOf: '2026-07-13' })]);
      expect(v.map((x) => x.rule)).toContain('valid_as_of_without_time_sensitive');
      expect(v[0].detail).toContain('季排程看不到這題');
    });

    it('練習池模式（validAsOfOnlyForTimeSensitive=false）不該誤報', () => {
      // 練習池的 provenance.verified_date 每題都有，本來就不限 time_sensitive。
      // 我第一版把主題庫的規則直接套過去，29 題全部誤報。
      expect(
        rules([clean({ validAsOf: '2026-07-13' })], new Set(), {
          validAsOfOnlyForTimeSensitive: false,
        })
      ).not.toContain('valid_as_of_without_time_sensitive');
    });
  });

  describe('5) corrected_but_unwatched —— 改過一次的答案，證明過它會變', () => {
    it('答案被更正過，卻既沒標 time_sensitive、也沒登記，會被抓到', () => {
      const v = checkFlags([clean({ priorAnswer: 'C' })]);
      expect(v.map((x) => x.rule)).toContain('corrected_but_unwatched');
      expect(v[0].detail).toContain('C');
    });

    it('登記在 stableIds 裡就放行', () => {
      expect(rules([clean({ id: 'Q1', priorAnswer: 'C' })], new Set(['Q1']))).not.toContain(
        'corrected_but_unwatched'
      );
    });

    it('標了 time_sensitive 就放行（季排程看得到它）', () => {
      expect(
        rules([
          clean({
            priorAnswer: 'C',
            flags: ['time_sensitive'],
            sourceUrls: ['https://law.moj.gov.tw/x'],
            validAsOf: '2026-07-13',
          }),
        ])
      ).not.toContain('corrected_but_unwatched');
    });

    it('登記清單只放行被登記的那一題，不會順手放行別題', () => {
      const v = checkFlags(
        [clean({ id: 'Q1', priorAnswer: 'C' }), clean({ id: 'Q2', priorAnswer: 'D' })],
        new Set(['Q1'])
      );
      const ids = v.filter((x) => x.rule === 'corrected_but_unwatched').map((x) => x.id);
      expect(ids).toEqual(['Q2']);
    });
  });

  it('一題可以同時違反多條規則，而且每一條都要報出來（不能只報第一條）', () => {
    // S_VOCUS_03-q004 就是同時中了 4) 和 5)
    const v = checkFlags([clean({ validAsOf: '2026-07-13', priorAnswer: 'C' })]);
    expect(v.map((x) => x.rule).sort()).toEqual([
      'corrected_but_unwatched',
      'valid_as_of_without_time_sensitive',
    ]);
  });

  it('formatFlagViolations 把 id、規則、細節三樣都印出來 —— 少一樣就查不下去', () => {
    const out = formatFlagViolations(checkFlags([clean({ id: 'S_VOCUS_03-q004', priorAnswer: 'C' })]));
    expect(out).toContain('S_VOCUS_03-q004');
    expect(out).toContain('corrected_but_unwatched');
    expect(out).toContain('C');
  });

  it('沒有違規時 formatFlagViolations 回空字串 —— gate 是拿它跟空字串比對的', () => {
    expect(formatFlagViolations(checkFlags([clean()]))).toBe('');
  });
});
