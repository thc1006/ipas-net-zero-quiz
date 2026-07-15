// AI 產題的揭露文案：**不得對使用者做出假的保證**
//
// 這道 gate 守的是一個實際存在過、而且完全沒有東西看得到的問題：
// **UI 對使用者說 AI 產題「已通過獨立驗證」。**
//
// 那個「獨立驗證」是 `provenance.verify_verdict = CONFIRMED`，
// 而該判定的作者是 `adversarial_subagent` —— **用 AI 去驗 AI 產的題**（149/157 題）。
//
// 2026-07 拿 law.moj.gov.tw 的逐字原文逐條比對，在練習池找到 13 個實質缺陷，
// **13 個當初全部被判 CONFIRMED**：
//   - 引號裡憑空捏造的法條原文（氣候法 §35 的「應參酌國際公約決議事項…」）
//   - 憑空多出來的「滯納金 15% 上限」（而該題的干擾選項正好寫著 15%）
//   - 捏造的法規名稱（《高碳洩漏風險行業認定辦法》根本不存在）
//   - 條號掛錯（碳費辦法 §5→§8、§6→§9、§9→§10）
//   - §32 的六款基金來源說成七款，還多編一款「基金孳息」
//   - 民國 106 年換算成 2016 年
//   - 一題有兩個正解（兩個選項是同一個數值）
//
// **一句假的保證比沒有保證更糟。**
// 它讓使用者放下戒心 —— 而 EU AI Act Art.50 的立法目的正好相反：
// 揭露的重點是讓人**知道這是 AI 產的、因此要自己查證**，不是安撫他「別擔心，驗過了」。
//
// practice-pool-schema.ts 裡早就寫過同一句話：
//     「provenance 是拿來被信任的，**它說謊比沒有還糟**。」
// 那句話當時只用來守一個很窄的矛盾（ambiguous 卻標 CONFIRMED）。這裡把它擴到文案上。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import poolRaw from '../data/practice_pool.json';
import { hasPrimarySource } from '../utils/source-authority';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 會被使用者看到的文案檔（不是註解 —— 註解裡談這件事是必要的）。 */
const UI_FILES = [
  'components/SourceBadge/SourceBadge.tsx',
  'components/SourceBanner/SourceBanner.tsx',
  'components/PracticeOptInDialog/PracticeOptInDialog.tsx',
  'pages/HomePage.tsx',
] as const;

/** 剝掉註解，只留真正會 render 出去的字。 */
function strippedSource(rel: string): string {
  const src = readFileSync(resolve(HERE, '..', rel), 'utf8');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // 區塊註解
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l)) // 整行註解
    .join('\n');
}

/**
 * 禁止的宣稱：任何形式的「這些題目已經被驗證過了，你可以放心」。
 * 不禁止「機器擋得住 X、擋不住 Y」這種**說清楚範圍**的講法 —— 那正是我們要的。
 */
const FALSE_ASSURANCE: ReadonlyArray<{ re: RegExp; why: string }> = [
  { re: /已通過(獨立)?驗證/, why: '「已通過驗證」—— 那個驗證是 AI 自評，13/13 的缺陷它都放行了' },
  { re: /已驗證/, why: '同上' },
  { re: /經驗證/, why: '同上' },
  { re: /(經|由).{0,6}獨立驗證/, why: '「獨立驗證」的驗證者是 adversarial_subagent —— 並不獨立' },
  { re: /cross-?check\s*通過/i, why: '同上' },
  { re: /交叉比對通過/, why: '同上' },
  { re: /驗證通過/, why: '同上' },
  { re: /答案.{0,4}正確無誤/, why: '沒有任何機制能保證這件事' },
];

describe('AI 產題的揭露文案不得做出假的保證', () => {
  it('這道 gate 不是空轉：文案檔讀得到，而且裡面確實有 AI 揭露的字樣', () => {
    for (const f of UI_FILES) {
      const s = strippedSource(f);
      expect(s.length, `${f} 讀不到`).toBeGreaterThan(200);
    }
    const all = UI_FILES.map(strippedSource).join('\n');
    expect(all).toMatch(/AI 產題/);
    expect(all).toMatch(/Art\.?\s*50/);
  });

  it('使用者看得到的文案裡，沒有任何「已驗證 / 已通過驗證」之類的保證', () => {
    const bad: string[] = [];
    for (const f of UI_FILES) {
      const s = strippedSource(f);
      for (const { re, why } of FALSE_ASSURANCE) {
        const m = s.match(re);
        if (m) bad.push(`${f}：出現「${m[0]}」—— ${why}`);
      }
    }
    expect(
      bad,
      '不要對使用者保證 AI 產題「已驗證」。\n' +
        '要講的是：**哪些機器擋得住（法條引文逐字比對、數值題手算登記），' +
        '哪些擋不住（條號掛錯、捏造機構名稱 —— 我們確實抓到過）。**'
    ).toEqual([]);
  });

  it('（變異測試）把「已通過獨立驗證」寫回去，這道 gate 必須抓到', () => {
    const mutant = "const title = 'AI 產題：本題由語言模型產生，已通過獨立驗證。';";
    const hit = FALSE_ASSURANCE.some((r) => r.re.test(mutant));
    expect(hit, '變異樣本沒被抓到 —— 這道 gate 沒有牙齒').toBe(true);
  });

  it('（變異測試）誠實說明範圍的文案不會被誤殺', () => {
    const honest =
      "hint: '由語言模型產生。解析中「」括起來的法條原文，CI 會逐字比對全國法規資料庫；" +
      "但「條號有沒有掛錯」機器驗不出來。請以法規原文為最終依據。'";
    const hit = FALSE_ASSURANCE.filter((r) => r.re.test(honest)).map((r) => r.why);
    expect(hit, '誠實的文案被誤判成假保證 —— 這道 gate 會逼人把話講得更含糊').toEqual([]);
  });
});

// 「每題附一手來源連結」—— 這句話說得出口，就要是真的。
//
// 實測（改之前）：100 題 AI 產題裡有 5 題**沒有任何一手來源**
// （只有 trec.org.tw、EcoVadis 說明頁、台積電新聞稿 —— 而這三個其實**都是**一手來源，
// 是我自己在 source-authority.ts 裡把它們分類錯了。分類錯誤本身也是一種說謊。）
describe('AI 產題必須有一手來源（UI 是這樣對使用者說的）', () => {
  interface PoolItem {
    id: string;
    sources: string[];
    provenance: { source_type: string };
  }
  const POOL = (poolRaw as unknown as { items: PoolItem[] }).items;
  const AI = POOL.filter((q) => q.provenance.source_type === 'ai_generated');

  it('這道 gate 不是空轉：確實有 AI 產題', () => {
    expect(AI.length).toBeGreaterThan(50);
  });

  it('每一題 AI 產題都至少有一條一手來源', () => {
    const bad = AI.filter((q) => !hasPrimarySource(q.sources ?? [])).map(
      (q) => `${q.id}：來源只有 ${(q.sources ?? []).join(', ') || '（無）'}`
    );
    expect(
      bad,
      'UI 對使用者說「AI 產題每題附一手來源連結」—— 這句話說得出口，就要是真的'
    ).toEqual([]);
  });
});
