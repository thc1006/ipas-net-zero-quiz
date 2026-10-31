// bundleContents 的負面測試：給它帶著 package.json 的產物，它要讓 build 失敗；乾淨的產物要放行。
//
// 這裡的 bundle 是假的，檔案是測試自己寫的，沒有經過 Vite 與 Rolldown。驗到的是檢查本身（看到這些檔案會不會紅），
// 驗不到 Vite 實際把 package.json 寫到哪裡：asset 有沒有進 bundle、worker 的產物長什麼樣、?inline 寫成什麼。
// 那要真的 build，升級 Vite 時要重新跑一次（?inline 的 CSS、JS 的 new URL、worker、index.html 各一種寫法）。
//
// 路徑不寫成字面值：vite.config.ts 屬於 tsconfig.node.json 的 composite 專案，直接 import 會是 TS6305。
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const { bundleContents } = (await import(/* @vite-ignore */ '../vite.config.ts' as string)) as {
  bundleContents: (publicDir?: string) => unknown;
};

const root = resolve(__dirname, '..');
const pkg = readFileSync(join(root, 'package.json'));
const base64 = pkg.toString('base64');
const dir = mkdtempSync(join(tmpdir(), 'bundle-contents-'));
afterAll(() => rmSync(dir, { recursive: true }));

// 題庫那一半的檢查要看到兩份題庫各是一個 JSON.parse 字串，否則每一個案例都會紅在那裡
const bankModules = Object.fromEntries(
  ['integrated_dataset.json', 'practice_pool.json'].map((name) => {
    const id = join(root, 'src/data', name);
    return [id, { code: `export default JSON.parse(${JSON.stringify(readFileSync(id, 'utf-8'))})` }];
  })
);

interface Output {
  body?: string | Buffer;
  type?: 'chunk' | 'asset';
  moduleIds?: string[];
  originalFileNames?: string[];
}

function write(base: string, fileName: string, body: string | Buffer): void {
  mkdirSync(dirname(join(base, fileName)), { recursive: true });
  writeFileSync(join(base, fileName), body);
}

function run(
  files: Record<string, Output>,
  publicFiles: Record<string, string> = {},
  modules: Record<string, { code: string }> = bankModules,
  publicLinks: Record<string, string> = {}
): void {
  const publicDir = mkdtempSync(join(dir, 'public-'));
  for (const [name, body] of Object.entries(publicFiles)) write(publicDir, name, body);
  for (const [name, target] of Object.entries(publicLinks)) symlinkSync(target, join(publicDir, name));
  const bundle: Record<string, unknown> = {
    'entry.js': { type: 'chunk', fileName: 'entry.js', moduleIds: [], modules },
  };
  write(dir, 'entry.js', '');
  for (const [fileName, { body = '', type = 'asset', moduleIds = [], originalFileNames }] of Object.entries(files)) {
    write(dir, fileName, body);
    bundle[fileName] =
      type === 'chunk' ? { type, fileName, moduleIds, modules: {} } : { type, fileName, originalFileNames };
  }
  const plugin = bundleContents(publicDir) as {
    writeBundle: (this: unknown, options: unknown, output: unknown) => void;
  };
  const context = {
    error(message: string) {
      throw new Error(message);
    },
  };
  plugin.writeBundle.call(context, { dir }, bundle);
}

const leaks = (fileName: string, body: string, type?: 'chunk' | 'asset') =>
  expect(() => run({ [fileName]: { body, type } }), fileName).toThrow(/devDependencies/);
const dataUrl = `data:application/json;base64,${base64}`;

describe('bundle-contents', () => {
  it('乾淨的產物放行', () => {
    run(
      {
        'a.js': { body: 'console.log(1)', type: 'chunk' },
        'a.css': { body: '.a{}' },
        'index.html': { body: '<p>' },
      },
      { 'robots.txt': 'User-agent: *' }
    );
  });

  it('照路徑認：chunk 的模組、asset 的來源是 package.json', () => {
    expect(() => run({ 'p.js': { type: 'chunk', moduleIds: [join(root, 'package.json?raw')] } })).toThrow(/來自 package.json/);
    expect(() => run({ 'p.json': { originalFileNames: ['package.json'] } })).toThrow(/來自 package.json/);
  });

  it('明文：chunk 與 worker 的產物（對主 build 只是 asset）', () => {
    leaks('c.js', pkg.toString(), 'chunk');
    leaks('assets/worker.js', pkg.toString());
  });

  it('base64：chunk、worker 的產物、CSS、HTML', () => {
    leaks('c2.js', `x="${dataUrl}"`, 'chunk');
    leaks('assets/worker2.js', `x="${dataUrl}"`);
    leaks('assets/a.css', `.a{background:url(${dataUrl})}`);
    leaks('index2.html', `<img src="${dataUrl}">`);
  });

  it('base64 剛好 20 個字元（devDependencies 這個字本身）', () => {
    const encoded = Buffer.from('devDependencies').toString('base64');
    expect(encoded).toHaveLength(20);
    leaks('e.css', `.a{background:url(data:text/plain;base64,${encoded})}`);
  });

  it('public/ 不經過打包，bundle 裡沒有它，也要看（子目錄也算）', () => {
    expect(() => run({}, { 'package.json': pkg.toString() })).toThrow(/devDependencies/);
    expect(() => run({}, { 'nested/deep/p.txt': base64 })).toThrow(/devDependencies/);
  });

  // Vite 複製 public/ 時解開連結，dist 裡是真的檔案：ln -s ../package.json public/pk.json
  it('public/ 的 symlink：連到檔案、連到目錄都要跟進去', () => {
    const linked = mkdtempSync(join(dir, 'linked-'));
    write(linked, 'sub/p.json', pkg.toString());
    expect(() => run({}, {}, bankModules, { 'pk.json': join(root, 'package.json') })).toThrow(/devDependencies/);
    expect(() => run({}, {}, bankModules, { cfg: linked })).toThrow(/devDependencies/);
  });

  it('題庫不是整份以一個 JSON.parse 字串載入就擋下', () => {
    const id = join(root, 'src/data/practice_pool.json');
    const message = /practice_pool\.json 的模組不是/;
    expect(() => run({}, {}, { ...bankModules, [id]: { code: 'export default { items: [] }' } })).toThrow(message);
    expect(() => run({}, {}, { ...bankModules, [id]: { code: `export default JSON.parse('{"items":[]}')` } })).toThrow(message);
  });

  it('.map 不看：sourcesContent 是原始碼，data/app-meta.ts 的註解就寫著這個字', () => {
    run({ 'a.js.map': { body: 'devDependencies' } });
  });

  it('二進位的 asset 不會誤判', () => {
    run({ 'f.woff2': { body: Buffer.from(Array.from({ length: 65536 }, (_, i) => (i * 131) & 255)) } });
  });

  // 7 MiB：{20,} 這種靠回溯的比對在單一字串超過約 5 MiB 時 RangeError
  it('很長的單一字串不會讓檢查本身出錯', () => {
    const long = 7 * 1024 * 1024;
    run({ 'big.js': { body: `x="${'A'.repeat(long)}"` } });
    run({ 'wide.js': { body: `x="${'測'.repeat(long / 3)}"` } });
    leaks('big-leak.js', `x="${'A'.repeat(long)}${base64}"`);
  }, 30_000);
});
