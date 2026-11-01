import { describe, expect, it } from 'vitest';
import dataset from './integrated_dataset.json';
import { allQuestions } from './questions';
import { currentIdsByOldId, currentQuestionId } from './renamed-questions';

interface RenamedItem {
  item_id: string;
  metadata?: { renamed_from?: { item_id: string } };
}

const renamed = (dataset.our_unique_items as RenamedItem[]).filter((q) => q.metadata?.renamed_from);

describe('改過 id 的題目', () => {
  it('題庫裡有改過 id 的題目（反空轉）', () => {
    expect(renamed.length).toBeGreaterThan(0);
  });

  it('舊 id 對到現在的 id', () => {
    for (const q of renamed) {
      expect(currentQuestionId(q.metadata!.renamed_from!.item_id)).toBe(q.item_id);
    }
  });

  it('現在的 id 都對到自己，認不得的 id 原樣返回', () => {
    for (const q of allQuestions) expect(currentQuestionId(q.id)).toBe(q.id);
    expect(currentQuestionId('fixture-1')).toBe('fixture-1');
  });

  it('改過兩次 id：每一代舊 id 都對到現在的 id', () => {
    const map = currentIdsByOldId([
      ['C', { item_id: 'B', previous: { item_id: 'A' } }],
      ['D', undefined],
    ]);

    expect([...map]).toEqual([['B', 'C'], ['A', 'C']]);
  });

  it('舊 id 不會是現在還在用的 id：否則那一題的進度與統計會算到別題去', () => {
    const current = new Set(allQuestions.map((q) => q.id));
    expect(renamed.map((q) => q.metadata!.renamed_from!.item_id).filter((id) => current.has(id))).toEqual([]);
  });
});
