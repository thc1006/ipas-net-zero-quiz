// metadata 的欄位名稱不得宣稱它做不到的事
//
// 這是這個專案第三次踩到同一個坑，而且一次比一次深：
//
//   1. 練習池的 `provenance.verify_verdict = CONFIRMED`（155/157）
//      —— 判定者是 adversarial_subagent（用 AI 驗 AI）。
//      我找到的 13 個實質缺陷，**13 個當初全部被判 CONFIRMED**。
//
//   2. UI 據此對使用者說「本題已通過獨立驗證」——
//      一句假的保證比沒有保證更糟（見 components/ai-disclosure.test.ts）。
//
//   3. **而主題庫更早就有一整組同樣的欄位**：
//      - `metadata.answer_verified: true` —— **全部 773 題**都是 true，
//        包括後來被證實答案是錯的 15 題。它不帶任何資訊。
//      - `metadata.sources_count: 1/2/3` —— **168 題宣稱有來源，
//        `metadata.sources` 卻根本不存在**。幽靈計數。
//      - `metadata.confidence: high` —— 390 題自評 high，沒有任何依據。
//      - `metadata.verification_source: "sync_from_310"` —— **270 題**。
//        它的意思是「答案從 questions.json（309 題的舊檔）**複製**過來」，
//        而那個檔案本身 0 條來源、93% 的解析帶著 `[1, 2, 3]` 這種捏造的引用編號。
//        **複製不是查證。**
//      - `metadata.verification_source: "batch_verification"`（72 題）、
//        `"research_agent"`（14 題）—— 同樣不是來源。
//
// **一個叫「已查證」但其實沒查證的欄位，比沒有這個欄位危險得多** ——
// 它會讓下一個人（或下一個 AI）跳過查證。
//
// 這些欄位已被搬進 `metadata._legacy_pipeline_metadata`（保留歷史，不再冒充證據）。
// 這道 gate 確保它們不會被放回去。
import { describe, it, expect } from 'vitest';
import datasetRaw from './integrated_dataset.json';

interface Item {
  index?: number;
  item_id?: string;
  metadata?: Record<string, unknown>;
  source?: unknown;
}
const DS = datasetRaw as unknown as {
  meta: Record<string, unknown>;
  gist_items: Item[];
  our_unique_items: Item[];
};
const ALL = [...DS.gist_items, ...DS.our_unique_items];
const who = (it: Item) => it.item_id ?? `gist[${it.index}]`;
const md = (it: Item) => it.metadata ?? {};

/** 名字宣稱了它做不到的事的欄位 —— 不得出現在 metadata 的頂層。 */
const BANNED: ReadonlyArray<{ field: string; why: string }> = [
  {
    field: 'answer_verified',
    why: '全部 773 題都是 true —— 包括後來被證實答案是錯的 15 題。它不帶任何資訊，只帶錯誤的安全感。',
  },
  {
    field: 'sources_count',
    why: '168 題宣稱有 1–3 條來源，metadata.sources 卻根本不存在。可推導的欄位一定會跟事實漂移 —— 直接讀 metadata.sources 的長度。',
  },
  {
    field: 'confidence',
    why: '390 題自評 high，沒有任何依據 —— 與 verify_verdict、answer_verified 同一個病。',
  },
  {
    field: 'verification_batch',
    why: '批次代號只說「屬於哪一批」，不說「驗了什麼」。它看起來像查證紀錄，其實不是。',
  },
  {
    field: 'verification_date',
    why: '全部 773 題都是同一天 —— 那是「批次跑的日期」，不是「查證的日期」。真正的查證日期是 metadata.valid_as_of。',
  },
];

/** verification_source 裡「不是來源」的值 —— 它們是資料管線的註記。 */
const NOT_A_SOURCE: ReadonlyArray<{ value: string; why: string }> = [
  {
    value: 'sync_from_310',
    why: '意思是「答案從 questions.json（309 題的舊檔）複製過來」。而那個檔案 0 條來源、93% 的解析帶著捏造的引用編號。**複製不是查證。**',
  },
  { value: 'batch_verification', why: '沒說驗了什麼、對什麼驗。' },
  {
    value: 'research_agent',
    why: 'AI 代理自評 —— 與練習池的 adversarial_subagent 同一個病（那個代理對 13 個實質缺陷全部判 CONFIRMED）。',
  },
];

describe('metadata 的欄位名稱不得說謊', () => {
  it('這道 gate 不是空轉：題庫確實有 metadata', () => {
    expect(ALL.filter((it) => Object.keys(md(it)).length > 0).length).toBeGreaterThan(700);
  });

  it.each(BANNED.map((b) => [b.field, b] as const))(
    'metadata.%s 不得存在於頂層',
    (_f, b) => {
      const bad = ALL.filter((it) => b.field in md(it)).map(who);
      expect(
        bad.length === 0 ? [] : [`${bad.length} 題仍有 metadata.${b.field}（例如 ${bad.slice(0, 3).join(', ')}）`],
        `**${b.field} 這個欄位在說謊。**\n  ${b.why}\n\n` +
          '  歷史值已保留在 metadata._legacy_pipeline_metadata —— 不要把它放回頂層。\n' +
          '  一個叫「已查證」但其實沒查證的欄位，比沒有這個欄位危險得多：**它會讓下一個人跳過查證。**'
      ).toEqual([]);
    }
  );

  it('verification_source 只能是「真實的引用」，不能是資料管線的註記', () => {
    const banned = new Set(NOT_A_SOURCE.map((n) => n.value));
    const bad = ALL.filter((it) => banned.has(String(md(it).verification_source ?? '').trim())).map(
      (it) => `${who(it)}: verification_source="${md(it).verification_source}"`
    );
    expect(
      bad,
      'verification_source 應該是「憑什麼相信這個答案」的引用（法條、CELEX、公告字號、ISO 條號）。\n' +
        NOT_A_SOURCE.map((n) => `  "${n.value}" —— ${n.why}`).join('\n') +
        '\n\n  這個欄位是「改過答案就必須留下理由」那道 gate 的合法理由之一 ——\n' +
        '  **如果它可以是 "sync_from_310"，那道 gate 就等於不存在。**'
    ).toEqual([]);
  });

  it('剩下的 verification_source 確實看起來像引用（不是空轉）', () => {
    const kept = ALL.map((it) => md(it).verification_source).filter(
      (v): v is string => typeof v === 'string' && v.trim().length > 0
    );
    expect(kept.length, '一個 verification_source 都沒有 —— 這條測試在空轉').toBeGreaterThan(100);
    // 引用必然會提到條文、標準、法規、公告或來源文件之一
    // 判準：一個「引用」必然會指名**文件**（法條、標準、公約、公告、要點、附件、教材）。
    // 我第一版漏了 UNFCCC / Cancún / 協定 / 要點 —— 結果把 gist[304] 的
    // 「UNFCCC Cancún Agreements 1/CP.16」這個**真的引用**判成不合格。
    // 判準太窄會逼人把好的引用改爛，跟判準太寬一樣糟。
    const looksLikeCitation =
      /§|第.{1,4}條|Art\.|Article|Regulation|Reg\s*\(|CELEX|Directive|ISO|IPCC|UNFCCC|Cancún|Cancun|CP\.\d|CMA|Agreement|Protocol|Treaty|Collection|公約|協定|條約|公告|字第|要點|附件|辦法|指引|準則|標準|PDF|教材|Table|CDP|NDC|CBAM|ETS|CORSIA|SBTi|GHG Protocol|IFRS|ISSB|IAASB|EFRAG|ESRS|TCFD|導覽頁|官方/u;
    const odd = [...new Set(kept)].filter((v) => !looksLikeCitation.test(v));
    expect(odd, 'verification_source 的值看起來不像引用').toEqual([]);
  });

  it('meta 裡必須留下「這件事發生過」的紀錄（否則下一個人會再犯一次）', () => {
    const note = DS.meta.metadata_honesty_note as Record<string, unknown> | undefined;
    expect(note, 'meta.metadata_honesty_note 不見了').toBeDefined();
    expect(note!.the_liars, '沒有列出哪些欄位在說謊').toBeDefined();
    expect(
      note!.verification_source_that_were_not_sources,
      '沒有列出哪些 verification_source 其實不是來源'
    ).toBeDefined();
    expect(note!.what_actually_verifies, '沒有列出「那什麼才是真的查證」').toBeDefined();
    expect(note!.still_unverified, '沒有誠實說出還有多少沒查證').toBeDefined();
  });

  // 幽靈來源：宣稱有 N 條，實際 0 條。這是 sources_count 被禁的原因，
  // 但同樣的錯可以用別的欄位名再犯一次 —— 所以直接釘住「不變量」。
  it('任何宣稱來源數量的欄位，都必須等於實際的來源數量', () => {
    const bad: string[] = [];
    for (const it of ALL) {
      const m = md(it);
      const actual =
        ((m.sources as unknown[] | undefined) ?? []).filter(
          (u) => typeof u === 'string' && u.startsWith('http')
        ).length +
        (typeof (it.source as { url?: unknown } | undefined)?.url === 'string' ? 1 : 0);
      for (const [k, v] of Object.entries(m)) {
        if (/count|數量|num_sources/i.test(k) && /source|來源/i.test(k) && typeof v === 'number') {
          if (v !== actual) bad.push(`${who(it)}: ${k}=${v}，實際只有 ${actual} 條`);
        }
      }
    }
    expect(
      bad,
      '「宣稱有 N 條來源」但實際不是 N 條 —— 幽靈來源。可推導的數字不要另存一份，它一定會漂移。'
    ).toEqual([]);
  });
});
