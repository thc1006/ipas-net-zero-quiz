// localStorage helper 測試
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readBool, writeBool } from './local-storage';

// 還原真實 localStorage（test-setup.ts 把它 mock 成空函式）
function installRealLocalStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k: string): string | null => store.get(k) ?? null,
      setItem: (k: string, v: string): void => { store.set(k, v); },
      removeItem: (k: string): void => { store.delete(k); },
      clear: (): void => { store.clear(); },
      key: (i: number): string | null => Array.from(store.keys())[i] ?? null,
      get length(): number { return store.size; },
    },
    writable: true,
    configurable: true,
  });
}

beforeAll(() => { installRealLocalStorage(); });

afterEach(() => {
  localStorage.clear();
});

describe('local-storage helpers', () => {
  it('readBool returns false for missing key', () => {
    expect(readBool('missing')).toBe(false);
  });

  it('readBool returns true for "1", false otherwise', () => {
    localStorage.setItem('flag-true', '1');
    localStorage.setItem('flag-false', '0');
    localStorage.setItem('flag-other', 'true');
    expect(readBool('flag-true')).toBe(true);
    expect(readBool('flag-false')).toBe(false);
    expect(readBool('flag-other')).toBe(false);
  });

  it('writeBool serializes to "1" / "0"', () => {
    writeBool('flag', true);
    expect(localStorage.getItem('flag')).toBe('1');
    writeBool('flag', false);
    expect(localStorage.getItem('flag')).toBe('0');
  });

  it('round-trips boolean correctly', () => {
    writeBool('a', true);
    writeBool('b', false);
    expect(readBool('a')).toBe(true);
    expect(readBool('b')).toBe(false);
  });

  it('readBool tolerates throwing localStorage (private mode)', () => {
    const orig = window.localStorage;
    Object.defineProperty(window, 'localStorage', {
      value: { getItem: () => { throw new Error('blocked'); } },
      configurable: true,
    });
    expect(readBool('any')).toBe(false);
    Object.defineProperty(window, 'localStorage', { value: orig, configurable: true });
  });

  it('writeBool tolerates throwing localStorage (quota)', () => {
    const orig = window.localStorage;
    Object.defineProperty(window, 'localStorage', {
      value: { setItem: () => { throw new Error('quota'); } },
      configurable: true,
    });
    expect(() => writeBool('any', true)).not.toThrow();
    Object.defineProperty(window, 'localStorage', { value: orig, configurable: true });
  });
});
