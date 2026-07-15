// 解析不得指涉選項的**字母** —— **主題庫與練習池一起守**。
//
// ⚠️ 這道 gate 之所以存在，是因為舊的那道**守了一半，而且判準太窄**：
//
//   1. **只守練習池。** 規則原本寫在 practice-pool-quality.test.ts 裡，
//      而那個檔案只 import practice_pool.json —— **一題主題庫都守不到**。
//      於是 `gist[304]`（「故 B、D 皆非」）、`gist[408]`（「A、B、C 都在其中」）
//      **從來沒有被任何 gate 檢查過**。
//
//   2. **要求「先有關鍵詞才接字母」。** 於是
//      `pool-em-ipas_vocus_mock-036` 的「**A、D 為 Scope 1**」整個漏掉 ——
//      而那句話正在教「採購原物料算範疇一」這個徹底錯誤的觀念，
//      而且它**自我矛盾**（前一句才說 A 屬 Category 1／範疇三）。
//      它一路活到第五輪的人工解析稽核才被抓到。
//
//      **一道抓不到 mock-036 的 gate，本來就沒抓到 mock-036。**
//
// 為什麼字母不能提：**字母不是內容，只是位置，而位置會變。**
// 練習池的選項被重排過；gist[14]/[529]/[532] 的整組選項被還原成官方版本。
// 位置一變，「答案為 B」就會指到別的東西 —— 而且**不會有任何測試變紅**。
import { describe, it, expect } from 'vitest';
import datasetRaw from './integrated_dataset.json';
import poolRaw from './practice_pool.json';
import { findLetterRefs, LETTER_REF_SAMPLES } from '../utils/explanation-hygiene';

interface Item {
  id?: string;
  item_id?: string;
  index?: number;
  explanation?: string | null;
}
const ds = datasetRaw as unknown as { gist_items: Item[]; our_unique_items: Item[] };
const pool = (poolRaw as unknown as { items: Item[] }).items;

const norm = (items: Item[], label: (i: Item) => string) =>
  items.map((i) => ({ id: label(i), explanation: i.explanation }));

const ALL = [
  ...norm(ds.gist_items, (i) => i.item_id ?? `gist[${i.index}]`),
  ...norm(ds.our_unique_items, (i) => i.item_id ?? `gist[${i.index}]`),
  ...norm(pool, (i) => i.id!),
];

describe('解析不得指涉選項的字母（兩個題庫一起守）', () => {
  // 「一個抓不到錯的把關，等於沒有把關。」先證明規則不是空轉。
  it('規則抓得到真的字母引用', () => {
    for (const s of LETTER_REF_SAMPLES.shouldMatch) {
      expect(
        findLetterRefs([{ id: 'x', explanation: s }]).length,
        `這句話應該被抓到：${s}`
      ).toBeGreaterThan(0);
    }
  });

  it('規則不會誤傷「只講內容、不提字母」的解析', () => {
    for (const s of LETTER_REF_SAMPLES.shouldNotMatch) {
      expect(
        findLetterRefs([{ id: 'x', explanation: s }]),
        `這句話不該被抓到（假陽性）：${s}`
      ).toEqual([]);
    }
  });

  it('全庫的解析都不指涉選項字母', () => {
    const bad = findLetterRefs(ALL).map((r) => `${r.id}：解析寫「${r.matched}」`);
    expect(
      bad,
      '解析請指涉選項的「內容」，不要指涉它的「字母」——\n' +
        '字母只是位置，而位置會變（選項重排、選項還原）。\n' +
        '位置一變，這句話就會指到別的東西，而且不會有任何測試變紅。'
    ).toEqual([]);
  });
});
