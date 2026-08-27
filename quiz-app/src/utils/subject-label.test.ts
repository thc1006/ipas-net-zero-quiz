// 未分類就顯示「待分類」——先前 UI 一律 `=== '考科1' ? '考科一' : '考科二'`，
// 於是練習池 154 題裡的 83 題 null 全被顯示成考科二。
import { describe, it, expect } from 'vitest';
import { subjectClass, subjectLabel } from './subject-label';

describe('subjectLabel', () => {
  it.each([
    ['考科1', '考科一'],
    ['考科2', '考科二'],
  ] as const)('%s → %s', (input, expected) => {
    expect(subjectLabel(input)).toBe(expected);
  });

  it.each([null, undefined])('未分類（%s）不冒充任何一科', (input) => {
    expect(subjectLabel(input)).toBe('待分類');
  });
});

describe('subjectClass', () => {
  it.each([
    ['考科1', 'subject-1'],
    ['考科2', 'subject-2'],
  ] as const)('%s → %s', (input, expected) => {
    expect(subjectClass(input)).toBe(expected);
  });

  it.each([null, undefined])('未分類（%s）有自己的 class，不套用任一科的配色', (input) => {
    expect(subjectClass(input)).toBe('subject-unmapped');
  });
});
