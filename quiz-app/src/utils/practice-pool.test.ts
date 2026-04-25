// practice-pool util 單元測試
import { describe, it, expect, beforeEach } from 'vitest';
import {
  filterPool,
  normalizeTopicTag,
  shuffle,
  randomSample,
  toQuizQuestion,
  loadPracticePool,
  __resetPracticePoolCacheForTesting,
} from './practice-pool';
import type { PracticePoolItem } from '../types/practicePool';

const baseItem = (over: Partial<PracticePoolItem> = {}): PracticePoolItem => ({
  id: 'pool-test-001',
  stem: 'Sample stem',
  options: [
    { key: 'A', text: 'a' },
    { key: 'B', text: 'b' },
  ],
  answer: 'A',
  explanation: '',
  subject: '考科2',
  topic_tags: ['CBAM'],
  difficulty: 'medium',
  provenance: {
    source_type: 'external_mock',
    source_origin: 'test',
    verified_date: '2026-04-25',
    verifier: 'test',
    verify_verdict: 'CONFIRMED',
    original_id: '1',
  },
  sources: [],
  quality_flags: [],
  ...over,
});

describe('normalizeTopicTag', () => {
  it('lowercases', () => {
    expect(normalizeTopicTag('CBAM')).toBe('cbam');
  });
  it('removes whitespace', () => {
    expect(normalizeTopicTag('CO 2 排放')).toBe('co2排放');
  });
  it('removes punctuation (full + half width)', () => {
    expect(normalizeTopicTag('碳邊境-CBAM')).toBe('碳邊境cbam');
    expect(normalizeTopicTag('A,B;C')).toBe('abc');
    expect(normalizeTopicTag('（淨零）')).toBe('淨零');
  });
});

describe('filterPool', () => {
  const items: PracticePoolItem[] = [
    baseItem({ id: 'a', provenance: { ...baseItem().provenance, source_type: 'external_mock' } }),
    baseItem({
      id: 'b',
      provenance: {
        source_type: 'ai_generated',
        source_origin: 'test',
        verified_date: '2026-04-25',
        verifier: 'test',
        verify_verdict: 'CONFIRMED',
        original_id: '2',
        ai_metadata: { model_family: 'unspecified', generation_date: '2026-04-25', verifier_round: 1 },
      },
    }),
    baseItem({ id: 'c', topic_tags: ['NDC'] }),
    baseItem({ id: 'd', quality_flags: ['time_sensitive'] }),
  ];

  it('no opts returns all', () => {
    expect(filterPool(items)).toHaveLength(4);
  });
  it('sourceTypes filter', () => {
    expect(filterPool(items, { sourceTypes: ['ai_generated'] }).map((x) => x.id)).toEqual(['b']);
  });
  it('topicTags normalized match', () => {
    expect(
      filterPool(items, { topicTags: ['cbam'] }).map((x) => x.id).sort()
    ).toEqual(['a', 'b', 'd'].sort());
  });
  it('excludeFlags filter', () => {
    const out = filterPool(items, { excludeFlags: ['time_sensitive'] });
    expect(out.find((x) => x.id === 'd')).toBeUndefined();
    expect(out).toHaveLength(3);
  });
});

describe('shuffle', () => {
  it('keeps same length & elements', () => {
    const arr = [1, 2, 3, 4, 5];
    const out = shuffle(arr);
    expect(out).toHaveLength(arr.length);
    expect(new Set(out)).toEqual(new Set(arr));
  });
  it('does not mutate input', () => {
    const arr = [1, 2, 3];
    shuffle(arr);
    expect(arr).toEqual([1, 2, 3]);
  });
  it('deterministic with seeded rng', () => {
    let i = 0;
    const seq = [0.1, 0.5, 0.9, 0.2, 0.4];
    const rng = () => seq[i++ % seq.length];
    const a = shuffle([1, 2, 3, 4, 5], rng);
    i = 0;
    const b = shuffle([1, 2, 3, 4, 5], rng);
    expect(a).toEqual(b);
  });
});

describe('randomSample', () => {
  it('returns all when n >= length', () => {
    expect(randomSample([1, 2, 3], 5)).toHaveLength(3);
  });
  it('returns n distinct items', () => {
    const out = randomSample([1, 2, 3, 4, 5], 3);
    expect(out).toHaveLength(3);
    expect(new Set(out).size).toBe(3);
  });
});

describe('toQuizQuestion', () => {
  it('sets sourceType to practice_pool (not unique)', () => {
    const q = toQuizQuestion(baseItem());
    expect(q.sourceType).toBe('practice_pool');
  });
  it('maps subject "考科一" → 考科1', () => {
    const q = toQuizQuestion(baseItem({ subject: '考科一' }));
    expect(q.subject).toBe('考科1');
  });
  it('maps "考科2" → 考科2', () => {
    const q = toQuizQuestion(baseItem({ subject: '考科2' }));
    expect(q.subject).toBe('考科2');
  });
  it('passes through provenance + qualityFlags + sources', () => {
    const item = baseItem({
      sources: ['https://example.org'],
      quality_flags: ['ambiguous'],
    });
    const q = toQuizQuestion(item);
    expect(q.provenance.source_type).toBe('external_mock');
    expect(q.qualityFlags).toContain('ambiguous');
    expect(q.sources).toContain('https://example.org');
  });
  it('hasAnswer reflects answer presence', () => {
    expect(toQuizQuestion(baseItem({ answer: null })).hasAnswer).toBe(false);
    expect(toQuizQuestion(baseItem({ answer: 'A' })).hasAnswer).toBe(true);
  });
});

describe('loadPracticePool (lazy)', () => {
  beforeEach(() => __resetPracticePoolCacheForTesting());
  it('returns same promise on subsequent calls (cached)', async () => {
    const p1 = loadPracticePool();
    const p2 = loadPracticePool();
    expect(p1).toBe(p2);
    const pool = await p1;
    expect(Array.isArray(pool.items)).toBe(true);
    expect(pool.items.length).toBeGreaterThan(0);
  });
  it('items have valid provenance.source_type', async () => {
    const pool = await loadPracticePool();
    for (const item of pool.items) {
      expect(['external_mock', 'ai_generated']).toContain(item.provenance.source_type);
    }
  });
  it('every ai_generated item has ai_metadata (discriminated union)', async () => {
    const pool = await loadPracticePool();
    for (const item of pool.items) {
      if (item.provenance.source_type === 'ai_generated') {
        expect(item.provenance.ai_metadata).toBeDefined();
        expect(item.provenance.ai_metadata.model_family).toBeTypeOf('string');
      }
    }
  });
});
