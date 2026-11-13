// 假的 localStorage 要照 Storage 的規則走：測試靠它判斷程式存了什麼，它自己錯了，那些測試就跟著錯
import { describe, it, expect } from 'vitest';
import { installRealLocalStorage } from './real-local-storage';

describe('installRealLocalStorage', () => {
  it('存、讀、刪都反映在回傳的 Map；沒有的 key 回 null', () => {
    const store = installRealLocalStorage();
    localStorage.setItem('a', '1');
    expect(store.get('a')).toBe('1');
    expect(localStorage.getItem('a')).toBe('1');
    expect(localStorage.getItem('missing')).toBeNull();
    localStorage.removeItem('a');
    expect(store.has('a')).toBe(false);
  });

  it('length 與 key(i) 照存的順序，超出範圍回 null；clear 全部清掉', () => {
    const store = installRealLocalStorage();
    localStorage.setItem('a', '1');
    localStorage.setItem('b', '2');
    expect(localStorage.length).toBe(2);
    expect([localStorage.key(0), localStorage.key(1), localStorage.key(2)]).toEqual(['a', 'b', null]);
    localStorage.clear();
    expect(localStorage.length).toBe(0);
    expect(store.size).toBe(0);
  });

  it('每次裝都是新的一份，不留上一次的資料', () => {
    installRealLocalStorage().set('a', '1');
    installRealLocalStorage();
    expect(localStorage.getItem('a')).toBeNull();
  });
});
