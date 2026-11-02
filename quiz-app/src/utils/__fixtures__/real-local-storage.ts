// 還原真實 localStorage 行為（test-setup.ts 把它 mock 成空函式）。回傳底下的 Map，測試可以直接看存了什麼
export function installRealLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k: string): string | null => store.get(k) ?? null,
      setItem: (k: string, v: string): void => {
        store.set(k, v);
      },
      removeItem: (k: string): void => {
        store.delete(k);
      },
      clear: (): void => {
        store.clear();
      },
      key: (i: number): string | null => Array.from(store.keys())[i] ?? null,
      get length(): number {
        return store.size;
      },
    },
    writable: true,
    configurable: true,
  });
  return store;
}
