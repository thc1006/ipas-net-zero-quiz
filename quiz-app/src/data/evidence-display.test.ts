// 「答案依據」顯示層 gate。
//
// 起因：這些逐字引文一直只存在資料裡，UI 只渲染一排來源連結。對使用者來說，
// 「公版教材原文」和「某篇部落格」看起來份量相同 —— 而答案其實只有前者撐得住。
//
// 這裡最重要的一條是「對回原始資料」：第一版寫成「有 evidence 的題數 > 100」，
// 那不管 selector 挑到哪一條都會綠，等於用測試把選錯的行為釘成預期。
import { describe, it, expect } from 'vitest';
import manifest from '../../../evidence-manifest.json';
import { allQuestions, dataset, getQuestionById, pickEvidence } from './questions';

const NL = String.fromCharCode(10);

interface RawEvidence {
  url?: string;
  quote?: string;
  supports_option?: string;
  authority?: string;
}
interface RawItem {
  index?: number;
  item_id?: string;
  stem: string;
  answer?: string | null;
  metadata?: { evidence?: RawEvidence[] };
}

const raw = dataset as unknown as {
  gist_items: RawItem[];
  our_unique_items: RawItem[];
};
const rawAll: RawItem[] = [...raw.gist_items, ...raw.our_unique_items];

describe('答案依據（evidence）顯示', () => {
  it('每一則顯示出來的答案依據，都能在原始資料裡對回「supports_option === 正解」', () => {
    const byKey = new Map<string, RawItem>();
    for (const it of rawAll) byKey.set(it.item_id ?? `gist-${it.index}`, it);

    const bad: string[] = [];
    let checked = 0;
    for (const q of allQuestions) {
      if (!q.evidence) continue;
      checked += 1;
      const src = byKey.get(q.id) ?? rawAll.find((it) => it.stem === q.stem);
      if (!src) {
        bad.push(`${q.id}: 在原始資料裡找不到對應題目`);
        continue;
      }
      const backing = (src.metadata?.evidence ?? []).find(
        (e) => (e.quote ?? '').trim() === q.evidence!.quote
      );
      if (!backing) {
        bad.push(`${q.id}: 顯示的引文在原始 evidence 裡找不到`);
        continue;
      }
      if (backing.supports_option !== src.answer) {
        bad.push(
          `${q.id}: 引文標的是 supports_option=${backing.supports_option ?? '(未標)'}，` +
            `正解卻是 ${src.answer ?? '(無)'}`
        );
      }
      if (!(backing.url ?? '').startsWith('https://')) {
        bad.push(`${q.id}: 來源不是 https（${backing.url ?? '(無)'}）`);
      }
    }

    expect(checked, '這道 gate 在空轉 —— 沒有任何題目帶答案依據').toBeGreaterThan(700);
    expect(bad, '有答案依據對不回原始 supports_option：' + NL + bad.join(NL)).toEqual([]);
  });

  it('沒有標到正解的題目一律不顯示答案依據（寧可不給，也不給錯的）', () => {
    const shouldHave = new Set(
      rawAll
        .filter((it) =>
          (it.metadata?.evidence ?? []).some(
            (e) =>
              it.answer &&
              e.supports_option === it.answer &&
              (e.quote ?? '').trim().length >= 8 &&
              (e.url ?? '').startsWith('https://')
          )
        )
        .map((it) => it.item_id ?? `gist-${it.index}`)
    );
    const wrong = allQuestions
      .filter((q) => q.evidence && !shouldHave.has(q.id))
      .map((q) => q.id);
    expect(wrong, '這些題目沒有撐住正解的引文，卻顯示了答案依據').toEqual([]);
  });


  it('引文的 authority 標記必須與 evidence-manifest 的分級一致（不得漂移）', () => {
    // manifest 才是分級的真相來源；dataset 上的 authority 只是給 runtime 用的副本。
    // 兩邊分開存就一定會漂，所以直接對帳。
    const entries = manifest as unknown as {
      entries: { url?: string; authority?: string }[];
    };
    const secondary = new Set(
      entries.entries.filter((e) => e.authority !== 'primary').map((e) => e.url)
    );
    const bad: string[] = [];
    for (const it of rawAll) {
      for (const e of it.metadata?.evidence ?? []) {
        const isSecondaryInManifest = secondary.has(e.url);
        const tagged = e.authority === 'secondary';
        if (isSecondaryInManifest !== tagged) {
          bad.push(
            `${it.item_id ?? `gist-${it.index}`}: manifest=${
              isSecondaryInManifest ? 'secondary' : 'primary'
            }，dataset=${e.authority ?? 'primary'}（${e.url ?? '(無 URL)'}）`
          );
        }
      }
    }
    expect(secondary.size, 'manifest 裡沒有任何非 primary 條目，這道對帳會空轉').toBeGreaterThan(0);
    expect(bad, '引文分級與 manifest 不一致：' + NL + bad.join(NL)).toEqual([]);
  });

  it('S_VOCUS_03-q004 顯示教材列出精密度/完整性/代表性的原文，不是部落格抄來的題幹', () => {
    const q = allQuestions.find((x) => x.id.includes('S_VOCUS_03-q004'));
    expect(q?.evidence, '這題應該要有答案依據').toBeDefined();
    const quote = q!.evidence!.quote;
    expect(quote).toContain('精密度');
    expect(quote).toContain('完整性');
    expect(quote).toContain('代表性');
    expect(quote.startsWith('ISO 14067 要求數據品質包含')).toBe(false);
    expect(q!.evidence!.url).not.toContain('vocus.cc');
  });

  it('gist[64] 顯示 CBAM 正式期 B.1 排除移動機械的法條原文', () => {
    const q = allQuestions.find((x) => x.stem.includes('Regulation (EU) 2025/2547'));
    expect(q?.evidence?.quote ?? '').toContain(
      'mobile machinery for transportation purposes shall be excluded'
    );
    expect(q?.evidence?.url ?? '').toContain('32025R2547');
  });

  it('getQuestionById 取回的題目同樣帶著答案依據（結果頁也看得到）', () => {
    const withEvidence = allQuestions.find((q) => q.evidence);
    expect(withEvidence).toBeDefined();
    expect(getQuestionById(withEvidence!.id)?.evidence?.quote).toBe(
      withEvidence!.evidence!.quote
    );
  });
});

describe('pickEvidence 的挑選規則（fail-closed）', () => {
  const base = { answer: 'B' as string | null };
  const ok = { quote: '這段文字支持選項 B，長度足夠通過門檻。', supports_option: 'B', url: 'https://example.org/s' };

  it('挑出標到正解的那一條，而不是排在前面的那一條', () => {
    const got = pickEvidence({
      ...base,
      metadata: {
        evidence: [
          { quote: '這段講的是別的選項，長度足夠。', supports_option: 'C', url: 'https://example.org/c' },
          ok,
        ],
      },
    });
    expect(got?.quote).toContain('支持選項 B');
    expect(got?.url).toBe('https://example.org/s');
  });

  it('只有支持錯誤選項的引文時，不顯示答案依據', () => {
    expect(
      pickEvidence({
        ...base,
        metadata: {
          evidence: [
            { quote: '這段引文只支持選項 C，而且長度足夠。', supports_option: 'C', url: 'https://example.org/c' },
          ],
        },
      })
    ).toBeUndefined();
  });

  it('只有未標 supports_option 的 provenance 時，不顯示答案依據', () => {
    expect(
      pickEvidence({
        ...base,
        metadata: {
          evidence: [{ quote: '這是題目來源，但沒有證明哪個選項正確。', url: 'https://example.org/p' }],
        },
      })
    ).toBeUndefined();
  });

  it('無標準答案的題目不顯示答案依據', () => {
    expect(
      pickEvidence({
        answer: null,
        metadata: { evidence: [{ ...ok }] },
      })
    ).toBeUndefined();
  });

  it('非 https 的來源不得進入 href', () => {
    for (const url of ['javascript:alert(1)', 'http://example.org/x', 'data:text/html,x']) {
      expect(
        pickEvidence({ ...base, metadata: { evidence: [{ ...ok, url }] } }),
        `${url} 不該通過`
      ).toBeUndefined();
    }
  });

  it('缺少來源 URL 的引文不顯示（無法查證就不要承諾）', () => {
    expect(
      pickEvidence({
        ...base,
        metadata: { evidence: [{ quote: ok.quote, supports_option: 'B' }] },
      })
    ).toBeUndefined();
  });

  it('過短的引文不算依據', () => {
    expect(
      pickEvidence({ ...base, metadata: { evidence: [{ ...ok, quote: '太短' }] } })
    ).toBeUndefined();
  });

  it('沒有 evidence 欄位就回 undefined', () => {
    expect(pickEvidence({ ...base })).toBeUndefined();
    expect(pickEvidence({ ...base, metadata: { evidence: [] } })).toBeUndefined();
  });
});
