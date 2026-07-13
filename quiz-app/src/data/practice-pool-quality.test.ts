// 練習池的品質 gate
//
// 這個檔案存在的理由：上一輪加在 dataset-integrity.test.ts 的五道 quality_flags gate
// **只 import integrated_dataset.json** —— 練習池 157 題一題都沒守到。
// 規則現在抽到 utils/quality-flags.ts，兩邊一起套。
import { describe, it, expect } from 'vitest';
import poolRaw from './practice_pool.json';
import { checkFlags, formatFlagViolations, type FlaggedItem } from '../utils/quality-flags';
import { classifyHost, hostOf } from '../utils/source-authority';
import datasetRaw from './integrated_dataset.json';

interface PoolItem {
  id: string;
  stem: string;
  options: { key: string; text: string }[];
  answer: string | null;
  explanation: string;
  quality_flags: string[];
  sources: string[];
  provenance: {
    source_type: string;
    source_origin: string;
    /** 練習池的「查證到哪一天」用的是這個欄位（主題庫用 metadata.valid_as_of） */
    verified_date: string;
    option_order?: { rebalanced_on: string; previous_answer: string; method: string; why: string };
  };
}
const POOL = (poolRaw as unknown as { items: PoolItem[]; _meta: { totals: Record<string, number> } })
  .items;
const META = (poolRaw as unknown as { _meta: { totals: Record<string, number> } })._meta;

const KEYS = ['A', 'B', 'C', 'D'] as const;

describe('練習池：quality_flags 一致性（與主題庫共用同一套規則）', () => {
  const asFlagged = (q: PoolItem): FlaggedItem => ({
    id: q.id,
    flags: q.quality_flags ?? [],
    sourceUrls: (q.sources ?? []).filter((s) => /^https?:\/\//.test(s)),
    validAsOf: q.provenance.verified_date ?? null,
    priorAnswer: null, // 練習池沒有答案更正機制
  });

  it('這道 gate 不是空轉：練習池確實有 time_sensitive 題目', () => {
    const ts = POOL.filter((q) => q.quality_flags.includes('time_sensitive'));
    expect(ts.length, '一題 time_sensitive 都沒有 —— 規則等於沒在跑').toBeGreaterThan(10);
  });

  it('flags 規則全數通過（未知 flag／time_sensitive 缺一手權威來源／缺查證日期）', () => {
    // 練習池的 verified_date 每題都有（不限 time_sensitive），
    // 所以「沒標 time_sensitive 就不該有查證日期」那條不適用 —— 見 FlagCheckOptions。
    const vs = checkFlags(POOL.map(asFlagged), new Set(), {
      validAsOfOnlyForTimeSensitive: false,
    });
    expect(
      vs.length === 0 ? '' : `\n${formatFlagViolations(vs)}\n`,
      '練習池違反了與主題庫相同的 quality_flags 規則'
    ).toBe('');
  });
});

describe('來源網域必須被明確分類', () => {
  // 原本的 PRIMARY 是一條 regex，失敗模式是「認不得就默默當成不權威」——
  // 它因此把歐盟執委會、SEC、GHG Protocol 都判成非權威。
  // 一個會安靜給出錯誤答案的分類器，比一個會大聲失敗的分類器危險得多。
  const ds = datasetRaw as unknown as {
    gist_items: { source?: { url?: string }; metadata?: { sources?: string[] } }[];
    our_unique_items: { source?: { url?: string }; metadata?: { sources?: string[] } }[];
  };
  const mainUrls = [...ds.gist_items, ...ds.our_unique_items].flatMap((q) => [
    ...(q.metadata?.sources ?? []),
    ...(q.source?.url ? [q.source.url] : []),
  ]);
  const poolUrls = POOL.flatMap((q) => q.sources ?? []);
  const hosts = [...new Set([...mainUrls, ...poolUrls].map(hostOf).filter((h): h is string => !!h))];

  it('兩個題庫用到的每一個網域，都必須被分類為 primary 或 secondary', () => {
    expect(hosts.length, '一個網域都沒抓到 —— 這條測試在空轉').toBeGreaterThan(20);
    const unknown = hosts.filter((h) => classifyHost(h) === null);
    expect(
      unknown,
      '有網域沒有被分類。**不要讓它默默算成「非權威」** —— 那正是舊 regex 出錯的方式。\n' +
        '請到 utils/source-authority.ts 加一行，寫清楚它是誰、為什麼算（或不算）一手來源。'
    ).toEqual([]);
  });
});

// 答案位置的分布
//
// 原本的練習池：**永遠選 B，就能拿 60 分**（vocus 那批 73.6%）。
// 已比對 vocus 原文的答案卡，確認偏斜是**從來源繼承**的（原文本身就 53–60% B），
// 不是抄錯答案卡 —— 但那不代表可以留著：一份「永遠選 B 得 60 分」的題庫，
// 作為練習的功能就是壞的，而且它教會使用者一個錯的解題捷徑。
//
// 主題庫**不套這條規則**：它是從真實考卷 PDF 重建的（B=32.3%，χ²=23.3，
// 那是真實考卷本來就有的輕微偏斜），選項順序有證據鏈，動它會讓畫面上的題目
// 與已驗證的來源 PDF 不一致。
describe('練習池：答案不得集中在某個字母', () => {
  const answered = POOL.filter((q) => q.answer != null && KEYS.includes(q.answer as never));
  const count = (k: string) => answered.filter((q) => q.answer === k).length;

  it('這道 gate 不是空轉：練習池有足夠的題目可統計', () => {
    expect(answered.length).toBeGreaterThan(100);
  });

  it('沒有任何字母超過 35% —— 否則「永遠選它」就是一條有效的解題捷徑', () => {
    const worst = KEYS.map((k) => ({ k, pct: (count(k) / answered.length) * 100 })).sort(
      (a, b) => b.pct - a.pct
    )[0];
    expect(
      `${worst.k}=${worst.pct.toFixed(1)}%`,
      `永遠選 ${worst.k} 就能拿 ${worst.pct.toFixed(1)} 分 —— 這份題庫不是在測驗知識`
    ).toSatisfy(() => worst.pct <= 35);
  });

  it('卡方檢定：分布與均勻分布沒有顯著差異（χ² < 7.81, df=3, p=0.05）', () => {
    const e = answered.length / 4;
    const chi = KEYS.reduce((s, k) => s + (count(k) - e) ** 2 / e, 0);
    expect(
      chi,
      `χ²=${chi.toFixed(2)}；分布 ${KEYS.map((k) => `${k}=${count(k)}`).join(' ')}`
    ).toBeLessThan(7.81);
  });

  it('重排過的題目都留下了痕跡（provenance.option_order 記錄原本的字母與理由）', () => {
    const moved = POOL.filter((q) => q.provenance.option_order);
    expect(moved.length, '沒有任何重排紀錄 —— 偏離沒被登記').toBeGreaterThan(100);
    for (const q of moved) {
      const oo = q.provenance.option_order!;
      expect(oo.previous_answer, `${q.id} 沒記原本的答案`).toMatch(/^[ABCD]$/);
      expect(oo.why, `${q.id} 沒寫為什麼要重排`).toBeTruthy();
      expect(oo.rebalanced_on, `${q.id} 沒記日期`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('重排沒有改到內容：每題的 4 個選項 key 仍是 A/B/C/D，且答案落在選項內', () => {
    for (const q of POOL) {
      expect(q.options.map((o) => o.key), q.id).toEqual([...KEYS]);
      if (q.answer != null) {
        expect(
          q.options.some((o) => o.key === q.answer),
          `${q.id} 的答案 ${q.answer} 不在選項裡`
        ).toBe(true);
      }
    }
  });

  // 「數字階梯」（四個選項各是一個數字、且原本就排序）在重排時只准整組反轉，
  // 不准打亂 —— 真實考卷不會把數字選項亂排。
  //
  // 注意這裡只檢查 method 標記為 ladder 的題目。
  // 我第一版寫成「所有四個數字選項的題目都必須排序」，結果被 mock-009 打臉：
  // 它的選項是 2.0°C / 1.5°C / 0.5°C / 3.1°C —— **來源本來就沒排序**。
  // 斷言比資料還嚴格，錯的是斷言。
  it('被判定為數字階梯的題目，重排後仍然是排序的', () => {
    const num = (t: string) => {
      const m = t.replace(/,/g, '').match(/\d+(?:\.\d+)?/g);
      return m && m.length === 1 ? Number(m[0]) : null;
    };
    const ladders = POOL.filter((q) => q.provenance.option_order?.method?.startsWith('ladder'));
    expect(ladders.length, '一個階梯都沒有 —— 這條測試在空轉').toBeGreaterThan(5);
    for (const q of ladders) {
      const n = q.options.map((o) => num(o.text)) as number[];
      expect(n.every((v) => v != null), `${q.id} 被判成階梯，但選項不是單一數字`).toBe(true);
      const asc = [...n].sort((a, b) => a - b);
      const ok =
        n.every((v, i) => v === asc[i]) || n.every((v, i) => v === asc[asc.length - 1 - i]);
      expect(ok, `${q.id} 的數字階梯被打亂了：${n.join(', ')}`).toBe(true);
    }
  });
});

describe('練習池：解析不得指名選項字母', () => {
  // 字母不是題目的一部分 —— 它只是「目前的排列」。
  // 解析寫「選項 B 是…」，等於把解析綁死在一個隨時可能變的排列上；
  // 這次重排就有 6 題的解析因此會指錯選項。
  it('沒有任何解析在指名 A/B/C/D', () => {
    const pat = /選項\s*[（(]?\s*[ABCD]|答案\s*(?:為|是|：|:)\s*[ABCD]|故選\s*[ABCD]/u;
    const bad = POOL.filter((q) => pat.test(q.explanation)).map(
      (q) => `${q.id}: ${q.explanation.match(pat)![0]}`
    );
    expect(
      bad,
      '解析請指涉選項的「內容」，不要指涉它的「字母」—— 選項一重排，字母就指錯了'
    ).toEqual([]);
  });
});

describe('練習池：_meta.totals 必須與實際題數一致', () => {
  it('totals 不能對資料說謊', () => {
    const em = POOL.filter((q) => q.provenance.source_type === 'external_mock').length;
    const ai = POOL.filter((q) => q.provenance.source_type === 'ai_generated').length;
    expect(META.totals.external_mock).toBe(em);
    expect(META.totals.ai_generated).toBe(ai);
    expect(META.totals.total).toBe(POOL.length);
    expect(em + ai).toBe(POOL.length);
  });

  it('沒有重複的題幹（rescue 流程曾經「新增」而不是「取代」，留下 2 題重複）', () => {
    const norm = (t: string) =>
      t.normalize('NFKC').replace(/[\p{P}\p{Z}\s_]+/gu, '').toLowerCase();
    const seen = new Map<string, string>();
    const dups: string[] = [];
    for (const q of POOL) {
      const k = norm(q.stem);
      if (seen.has(k)) dups.push(`${q.id} 與 ${seen.get(k)} 題幹相同`);
      else seen.set(k, q.id);
    }
    expect(dups).toEqual([]);
  });
});
