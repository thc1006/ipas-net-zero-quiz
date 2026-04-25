// option-prefix util 測試
import { describe, it, expect } from 'vitest';
import { findRedundantPrefix } from './option-prefix';

describe('findRedundantPrefix', () => {
  it('returns shared first word when all options share it AND stem contains it', () => {
    const stem = 'GRI 準則 2021 之系統架構分為三個系列準則，下列何者正確？';
    const opts = [
      'GRI 環境準則、GRI 社會準則、GRI 治理準則',
      'GRI 環境準則、GRI 社會準則、GRI 經濟準則',
      'GRI 通用準則、GRI 進階準則、GRI 特殊準則',
      'GRI 通用準則、GRI 行業準則、GRI 主題準則',
    ];
    expect(findRedundantPrefix(stem, opts)).toBe('GRI');
  });

  it('returns null when options first words differ', () => {
    const stem = '某題目';
    const opts = ['ABC 內容', 'XYZ 內容', 'ABC 不一樣', 'XYZ 又不同'];
    expect(findRedundantPrefix(stem, opts)).toBeNull();
  });

  it('returns null when prefix not present in stem (not redundant)', () => {
    const stem = '請選出符合要求的選項';
    const opts = ['GRI A', 'GRI B', 'GRI C', 'GRI D'];
    expect(findRedundantPrefix(stem, opts)).toBeNull();
  });

  it('returns null for single-char prefix (avoid over-dimming)', () => {
    const stem = '某 X 題目';
    const opts = ['X 選 A', 'X 選 B', 'X 選 C'];
    expect(findRedundantPrefix(stem, opts)).toBeNull();
  });

  it('returns null with fewer than 2 options', () => {
    expect(findRedundantPrefix('any', ['only one'])).toBeNull();
    expect(findRedundantPrefix('any', [])).toBeNull();
  });

  it('handles options with leading whitespace gracefully', () => {
    const stem = 'GRI 是什麼？';
    const opts = [
      'GRI 是治理',
      ' GRI 是社會', // leading space
      'GRI 是環境',
    ];
    // 第二個選項首字非 GRI（而是 space），不算共享 → null
    expect(findRedundantPrefix(stem, opts)).toBeNull();
  });

  it('works for SASB / TCFD / 其他常見 prefix', () => {
    const stem = 'TCFD 架構分為四大支柱';
    const opts = ['TCFD 治理', 'TCFD 策略', 'TCFD 風險管理', 'TCFD 指標與目標'];
    expect(findRedundantPrefix(stem, opts)).toBe('TCFD');
  });

  it('does NOT dim when one option lacks the prefix (genuine difference)', () => {
    const stem = 'GRI 與 SASB 比較';
    const opts = [
      'GRI 著重利害關係人',
      'GRI 為通用準則',
      'SASB 著重投資人', // 缺 GRI
      'GRI 採行業差異化',
    ];
    expect(findRedundantPrefix(stem, opts)).toBeNull();
  });

  it('multi-token: 共享 2 個 token (e.g., GRI 準則)', () => {
    const stem = 'GRI 準則之系統架構分為三大類';
    const opts = [
      'GRI 準則 環境',
      'GRI 準則 社會',
      'GRI 準則 治理',
      'GRI 準則 經濟',
    ];
    expect(findRedundantPrefix(stem, opts)).toBe('GRI 準則');
  });

  it('multi-token: 不超出最短選項長度（防整個選項都是 prefix）', () => {
    const stem = 'GRI 準則';
    const opts = [
      'GRI 準則', // 整個選項就是 prefix
      'GRI 準則 環境',
      'GRI 準則 社會',
    ];
    // commonLen 會是 2，但第一個選項只有 2 token → reject
    expect(findRedundantPrefix(stem, opts)).toBeNull();
  });
});
