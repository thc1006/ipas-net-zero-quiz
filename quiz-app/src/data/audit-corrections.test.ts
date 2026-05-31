// 稽核修正回歸測試
// 鎖定 c2-190、c2-006、c2-132 等審核過的答案，避免被誤改回去
import { describe, it, expect } from 'vitest';
import questionsRaw from './questions.json';
import datasetRaw from './integrated_dataset.json';

interface RawQ {
  id: string;
  question: string;
  options: Record<string, string>;
  answer: string;
  explanation?: string;
  metadata?: { sources?: string[]; sources_verified_date?: string };
}

interface DatasetItem {
  index: number;
  stem: string;
  answer: string;
  options: { key: string; text: string }[];
  metadata?: { original_id?: string; sources?: string[] };
  explanation?: string;
}

const Q1 = questionsRaw as unknown as RawQ[];
const DS = datasetRaw as unknown as { gist_items: DatasetItem[] };

const byId = (id: string) => Q1.find((q) => q.id === id);
const byIndex = (idx: number) => DS.gist_items.find((g) => g.index === idx);

describe('audit corrections regression', () => {
  describe('c2-190 一級數據佔上游排放（discussion #1）', () => {
    const q = byId('c2-190');
    it('answer should be B (10%, not 20%)', () => {
      expect(q?.answer).toBe('B');
    });
    it('option B 文字含 10', () => {
      expect(q?.options.B).toContain('10');
    });
    it('explanation includes 10%', () => {
      expect(q?.explanation).toContain('10%');
    });
    it('explanation does NOT contain "原環境部" anachronism', () => {
      expect(q?.explanation).not.toContain('（原環境部）');
    });
    it('metadata.sources includes vocus citation', () => {
      const sources = q?.metadata?.sources ?? [];
      expect(sources.some((u) => u.includes('vocus.cc'))).toBe(true);
    });
  });

  describe('c2-006 溫管辦法主導查驗員', () => {
    const q = byId('c2-006');
    it('answer should be C (6 years)', () => {
      expect(q?.answer).toBe('C');
    });
    it('explanation cites §8 (not §14)', () => {
      // §8 第 2 項第 2 款 — should appear; §14 should not be the answer reference
      expect(q?.explanation).toContain('第 8 條');
    });
  });

  describe('c2-132 CDP 揭露範疇', () => {
    const q = byId('c2-132');
    it('answer should be A (土壤, not 塑膠)', () => {
      expect(q?.answer).toBe('A');
    });
    it('option A is 土壤', () => {
      expect(q?.options.A).toBe('土壤');  // 短字無需 loose
    });
  });

  describe('CBAM Omnibus dates (Reg 2025/2083)', () => {
    it('c1-038 surrender deadline option C → 9 月 30 日', () => {
      expect(byId('c1-038')?.options.C).toMatch(/9\s*月\s*30\s*日/);
    });
    it('c1-040 first submission option B → 2027 年 9 月 30 日', () => {
      expect(byId('c1-040')?.options.B).toMatch(/2027\s*年\s*9\s*月\s*30\s*日/);
    });
  });

  describe('NDC 3.0 update', () => {
    it('c2-086 option B → 28 % ± 2 %', () => {
      expect(byId('c2-086')?.options.B).toMatch(/28\s*%\s*±\s*2\s*%/);
    });
  });

  describe('SF6 GWP AR5 (23,500)', () => {
    const sf6_50 = byIndex(480);
    const sf6_60 = byIndex(494);
    it('gist[480] 50kg SF6 answer D = 1,175 tCO2e', () => {
      const optD = sf6_50?.options.find((o) => o.key === 'D')?.text;
      expect(optD).toMatch(/1[,\s]?175\s*tCO2e/);
    });
    it('gist[494] 60kg SF6 answer D = 1,410 tCO2e', () => {
      const optD = sf6_60?.options.find((o) => o.key === 'D')?.text;
      expect(optD).toMatch(/1[,\s]?410\s*tCO2e/);
    });
  });

  describe('Cat 4/5 stem fix', () => {
    const q = byIndex(179);
    it('gist[179] stem mentions Category 5 (not 4) for use phase', () => {
      expect(q?.stem).toContain('Category 5');
    });
  });

  describe('threshold law source correction', () => {
    const q = byIndex(150);
    it('gist[150] explanation cites 公告 (not §5)', () => {
      expect(q?.explanation).toContain('1139101260');
    });
  });

  describe('c2-006 / gist[88] citation accuracy', () => {
    const q = byIndex(89);
    it('gist[89] explanation cites §56 (1500 元 cap)', () => {
      expect(q?.explanation).toContain('第 56 條');
    });
  });

  describe('c2-074 巴黎協定 enriched explanation (issue #82)', () => {
    const q = byId('c2-074');
    it('explanation 帶 COP21 / UN Treaty Collection / 2015 年 12 月 12 日 任一關鍵字', () => {
      expect(q?.explanation).toMatch(/COP21|UN Treaty Collection|2015 年 12 月 12 日/);
    });
    it('explanation 不應再含 [1, 2, 3, 4] stub', () => {
      expect(q?.explanation).not.toMatch(/\[1, ?2, ?3, ?4\]/);
    });
    it('metadata.sources 含 UN Treaty Collection URL', () => {
      const sources = q?.metadata?.sources ?? [];
      // 用 hostname 比對而非 substring — 避免把 'evil.com/treaties.un.org' 誤認為 UN
      // 且更貼近這個測試的本意：驗證 source URL 確實指向 UN Treaty Collection 主機。
      // CodeQL: js/incomplete-url-substring-sanitization
      expect(
        sources.some((u) => {
          try {
            const host = new URL(u).hostname;
            return host === 'treaties.un.org' || host.endsWith('.treaties.un.org');
          } catch {
            return false;
          }
        })
      ).toBe(true);
    });
    it('integrated_dataset gist[267] explanation 同步 enriched', () => {
      expect(byIndex(267)?.explanation).toMatch(/COP21|2015 年 12 月 12 日/);
    });
  });

  describe('c2-089 AR6「10次方」偽造題已移除 (issue #85)', () => {
    it('c2-089 不應出現於 questions.json (AR6 無此敘述, 已移除)', () => {
      expect(byId('c2-089')).toBeUndefined();
    });
    it('gist[282] 不應出現於 integrated_dataset.json', () => {
      expect(byIndex(282)).toBeUndefined();
    });
  });
});
