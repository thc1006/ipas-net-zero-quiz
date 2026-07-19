// 「不用會，也能猜對」—— README 上那個數字，必須真的等於資料算出來的。
//
// 這一組 gate 守的是一種**跟「答案對不對」完全不同的病**：
// 題目出得太爛，以至於使用者靠破綻就能答對 —— **分數被灌水，而他什麼都沒學到。**
//
// ⚠️ 它**不會**因為 AI 產題的答案是對的就變綠。`verify_verdict: CONFIRMED`
//    對這件事一無所知（而那個欄位本來就沒有保證力：先前找到的 13 個缺陷，
//    13 個全部被標成 CONFIRMED）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import datasetRaw from './integrated_dataset.json';
import poolRaw from './practice_pool.json';
import { blatantLengthTells, longestOptionScore, type LeakItem } from '../utils/answer-leakage';

const README = readFileSync(join(__dirname, '../../../README.md'), 'utf8');

const DS = datasetRaw as unknown as { gist_items: LeakItem[]; our_unique_items: LeakItem[] };
const POOL = poolRaw as unknown as {
  items: (LeakItem & { id: string; provenance: { source_type: string } })[];
};
const AI = POOL.items.filter((i) => i.provenance.source_type === 'ai_generated');
const MOCK = POOL.items.filter((i) => i.provenance.source_type === 'external_mock');

const pct = (x: { hit: number; n: number }) => Math.round((x.hit / x.n) * 1000) / 10;

describe('答案洩漏：「無腦選最長」能考幾分', () => {
  it('這條測試不能空轉 —— 母體要夠大', () => {
    expect(AI.length).toBeGreaterThan(50);
    expect(DS.gist_items.length).toBeGreaterThan(400);
  });

  // 這是**已知的缺陷**，不是回歸測試 —— 我們沒有能力把 100 題 AI 產題的誘答重寫
  // （用同一個 AI 去補誘答，很可能生出「第二個正解」，那比現在更糟）。
  // 所以這裡做的是：**把它釘住，不准它變得更爛，而且不准 README 少說。**
  // ⚠️ 錨點綁在**表格列首的標籤**上，不要綁在散文上 ——
  //    這個 repo 已經被「有人潤稿，規則就靜靜死掉」咬過兩次。
  it('README 必須誠實揭露 AI 產題的「選最長」得分率，且與資料一致', () => {
    const m = README.match(/\|\s*🤖\s*\*\*練習池 AI 產題\*\*\s*\|\s*\*\*([\d.]+)%\*\*/);
    expect(m, 'README 找不到「🤖 練習池 AI 產題」那一列的得分率').not.toBeNull();
    expect(Number(m![1]), 'README 的數字與資料實算不符').toBe(pct(longestOptionScore(AI)));
  });

  it('AI 產題的洩漏程度不准再惡化（釘在現況）', () => {
    // 現況 65%（2026-07-19 救回 intl-018／tw_regs_14 時特意讓正解不是最長選項，較先前 66.3% 更低）。
    // 任何新增/修改若把它推得更高，就是在讓工具變得更沒用。
    expect(pct(longestOptionScore(AI))).toBeLessThanOrEqual(65);
  });

  it('主題庫（真正拿來考試的那一份）不准被 AI 產題的病傳染', () => {
    // 社群考古題的「露骨長度洩漏」只有 0.2%，重建題 1.3% —— 這是真實試題的水準。
    // 若有人往主題庫塞 AI 生成的題目，這條會先紅。
    const gist = blatantLengthTells(DS.gist_items).length / DS.gist_items.length;
    const restored = blatantLengthTells(DS.our_unique_items).length / DS.our_unique_items.length;
    expect(gist, '主題庫 gist 的露骨長度洩漏突然升高 —— 有人塞了生成題？').toBeLessThan(0.03);
    expect(restored, '主題庫重建題的露骨長度洩漏突然升高').toBeLessThan(0.03);
  });

  it('公開模擬題（真人出的）的洩漏明顯低於 AI 產題 —— 這證明那是生成指紋', () => {
    const ai = blatantLengthTells(AI).length / AI.length;
    const mock = blatantLengthTells(MOCK).length / MOCK.length;
    expect(ai).toBeGreaterThan(mock * 2);
  });
});
