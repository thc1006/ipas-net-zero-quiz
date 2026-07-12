// 共用完整性 gate —— 主題庫 **與** 練習池都要通過同一組規則。
//
// 起因：dataset-integrity.test.ts 只 import integrated_dataset.json，所以那道 gate
// 只守得住主題庫。實測把一筆「雙欄錯置」樣式的髒資料就地塞進 practice_pool 的
// external_mock 題（3 個選項、內嵌換行、PDF 頁首頁尾、answer='Z' 不在選項裡、
// sources=['not-a-url']、標了 time_sensitive 卻沒有可驗證來源），
// 全套 475 條測試 **exit=0，一條都沒抓到**。
//
// 規則本身放在 utils/question-integrity.ts，這裡只負責把兩個題庫接上去。
import { describe, it, expect } from 'vitest';
import datasetRaw from './integrated_dataset.json';
import poolRaw from './practice_pool.json';
import {
  checkAll,
  formatViolations,
  type IntegrityQuestion,
} from '../utils/question-integrity';

interface Opt {
  key: string;
  text: string;
}
interface MainItem {
  index?: number;
  item_id?: string;
  stem: string;
  options: Opt[];
  answer?: string | null;
  quality_flags?: string[];
  source?: { url?: string };
  metadata?: { sources?: string[] };
}
interface PoolItem {
  id: string;
  stem: string;
  options: Opt[];
  answer: string | null;
  quality_flags?: string[];
  sources?: string[];
  provenance: { source_type: string };
}

const DS = datasetRaw as unknown as {
  gist_items: MainItem[];
  our_unique_items: MainItem[];
};
const POOL = poolRaw as unknown as { items: PoolItem[] };

// workflow 的 jq 是從 source.url + metadata.sources[] 兩處取 URL；
// 這裡必須用同一套取法，否則測試會對「覆蓋率」說謊。
const fromMain = (it: MainItem): IntegrityQuestion => ({
  id: it.item_id ?? `gist[${it.index}]`,
  stem: it.stem,
  options: it.options,
  answer: it.answer,
  qualityFlags: it.quality_flags ?? [],
  sourceUrls: [it.source?.url, ...(it.metadata?.sources ?? [])].filter(
    (u): u is string => typeof u === 'string'
  ),
});

const fromPool = (it: PoolItem): IntegrityQuestion => ({
  id: it.id,
  stem: it.stem,
  options: it.options,
  answer: it.answer,
  qualityFlags: it.quality_flags ?? [],
  sourceUrls: it.sources ?? [],
});

const MAIN = [...DS.gist_items, ...DS.our_unique_items].map(fromMain);
const POOL_Q = POOL.items.map(fromPool);

describe('共用完整性 gate', () => {
  it('主題庫通過所有共用規則', () => {
    const v = checkAll(MAIN);
    expect(v, `主題庫違規：\n${formatViolations(v)}`).toEqual([]);
  });

  // 這條是本次補上的關鍵缺口。原本練習池完全沒有這層保護，
  // 而且既有的 practice_pool_integrity.test.ts 只掃 ai_generated（102 題），
  // 55 題 external_mock 連那層都沒有。這裡掃「全部 157 題」。
  it('練習池通過所有共用規則（含 external_mock，不只 ai_generated）', () => {
    const v = checkAll(POOL_Q);
    expect(v, `練習池違規：\n${formatViolations(v)}`).toEqual([]);
  });

  it('兩個題庫都非空，且練習池確實含 external_mock（避免規則空跑）', () => {
    expect(MAIN.length).toBeGreaterThan(700);
    expect(POOL_Q.length).toBeGreaterThan(150);
    expect(
      POOL.items.filter((i) => i.provenance.source_type === 'external_mock').length
    ).toBeGreaterThan(0);
  });
});
