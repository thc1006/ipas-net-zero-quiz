// 應用程式中繼資料：注入的常數就是 package.json 的值。vitest.config.ts 用的是 vite.config.ts 的同一份 define
// （shared），這裡驗到的就是正式 build 出貨的值。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_VERSION, BUG_REPORT_URL } from './app-meta';

const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', '..', 'package.json'), 'utf8')) as {
  version: string;
  bugs: { url: string };
};

// 引號裡寫著 package.json 的路徑（可以帶 ?raw 這類 query）。只寫這一份：掃描與自我測試用的是同一個
const QUOTED = /['"`][^'"`\n]*package\.json(\?[^'"`\n]*)?['"`]/;

describe('app-meta', () => {
  it('版本與問題回報網址就是 package.json 寫的', () => {
    expect(APP_VERSION).toBe(pkg.version);
    expect(BUG_REPORT_URL).toBe(pkg.bugs.url);
  });

  it('出貨的程式不引用 package.json（任何寫法：import、?raw、?url、動態 import、alias）', () => {
    // 測試檔不出貨，可以讀 package.json（例如這一支）
    const files = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'], {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    const referencing = Object.entries(files)
      .filter(([, text]) => QUOTED.test(text as string))
      .map(([file]) => file);
    expect(Object.keys(files), '找不到 src 的檔案：這條測試在空轉').toContain(
      '../pages/SettingsPage.tsx'
    );
    // glob 本來就不含發出 import 的這一支，所以直接看有沒有任何測試檔被掃進來
    expect(Object.keys(files).filter((file) => /\.test\.tsx?$/.test(file))).toEqual([]);
    expect(referencing).toEqual([]);
  });

  it('掃描抓得到每一種引用的寫法', () => {
    for (const line of [
      "import pkg from '../../package.json';",
      "import raw from '../../package.json?raw';",
      "import url from '../../package.json?url';",
      "const pkg = await import('../../package.json');",
      'import pkg from "@/../package.json";',
    ]) {
      expect(QUOTED.test(line), line).toBe(true);
    }
    expect(QUOTED.test('// 從 package.json 讀取')).toBe(false);
  });
});
