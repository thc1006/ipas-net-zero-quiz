// E2E 不可以連到頁尾訪客計數器的外部服務（tests/e2e/fixtures.ts 說明原因）。擋法是 fixtures.ts 的 test：
// 它開的每個 context 都先把計數器的請求回成固定值。這裡掃 playwright.config.ts 的 testDir 底下每個模組
// （Playwright 會跑的檔與 helper，fixtures.ts 除外），守三件事：
// - 不從 @playwright/test 拿值，型別與 devices、chromium、firefox、webkit 除外。test 用哪種寫法都不行：
//   具名、改名、default、namespace、re-export、dynamic import、require；
// - Playwright 會跑的檔（符合預設 testMatch）的 test 從 fixtures 來；
// - 自己開的 context（newContext、launchPersistentContext，browser.newPage() 背後也開一個）放進 const 變數，
//   那個變數第一次被用到就是 await stubVisitorCounter(變數)。追不到的寫法一律不准。
// 用 TypeScript 的 parser 與 checker：import 換行、型別與值混著 import、同名變數，regex 都容易漏
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import ts from 'typescript';

const QUIZ_APP = join(__dirname, '..');

interface Source {
  /** testDir 底下的相對路徑，用 / 分隔 */
  file: string;
  text: string;
}

const PW = new Set(['@playwright/test', 'playwright/test']);
// spec 從 @playwright/test 拿的值：瀏覽器與裝置描述
const PW_VALUES = new Set(['devices', 'chromium', 'firefox', 'webkit']);
const OPENERS = new Set(['newContext', 'launchPersistentContext', 'newPage']);
const CODE = /\.[cm]?[jt]sx?$/;

// Playwright 預設的 testMatch：**/*.@(spec|test).?(c|m)[jt]s?(x)
const isTestFile = (rel: string): boolean => /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(rel);
const isFixtures = (file: string, spec: string): boolean =>
  posix.join(posix.dirname(file), spec).replace(CODE, '') === 'fixtures';
const methodName = (n: ts.Node): string | undefined =>
  ts.isPropertyAccessExpression(n)
    ? n.name.text
    : ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)
      ? n.argumentExpression.text
      : undefined;

/** 從 @playwright/test 拿了哪些值（型別與 PW_VALUES 不算） */
function pwValues(n: ts.ImportDeclaration | ts.ExportDeclaration): string[] {
  if (ts.isExportDeclaration(n)) return n.isTypeOnly ? [] : ['export ... from'];
  const c = n.importClause;
  if (!c || c.isTypeOnly) return [];
  const b = c.namedBindings;
  return [
    ...(c.name ? [`default（${c.name.text}）`] : []),
    ...(b && ts.isNamespaceImport(b) ? [`* as ${b.name.text}`] : []),
    ...(b && ts.isNamedImports(b)
      ? b.elements
          .filter((e) => !e.isTypeOnly && !PW_VALUES.has((e.propertyName ?? e.name).text))
          .map((e) => (e.propertyName ?? e.name).text)
      : []),
  ];
}

function scan(sources: Source[]): { problems: string[]; opened: string[] } {
  // 只解析這幾個檔、不讀 lib 與 node_modules：checker 只用來認同一個變數
  const texts = new Map(sources.map((s) => ['/e2e/' + s.file, s.text]));
  const host = ts.createCompilerHost({});
  host.getSourceFile = (name, target) => {
    const text = texts.get(name);
    return text === undefined ? undefined : ts.createSourceFile(name, text, target, true);
  };
  host.fileExists = (name) => texts.has(name);
  host.readFile = (name) => texts.get(name);
  const program = ts.createProgram(
    [...texts.keys()],
    { allowJs: true, noLib: true, noResolve: true, types: [], jsx: ts.JsxEmit.Preserve },
    host
  );
  const checker = program.getTypeChecker();
  const problems: string[] = [];
  const opened: string[] = [];

  for (const { file } of sources) {
    const sf = program.getSourceFile('/e2e/' + file)!;
    const at = (n: ts.Node, msg: string): void => {
      problems.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${msg}`);
    };
    const symbolOf = (id: ts.Identifier): ts.Symbol | undefined =>
      ts.isShorthandPropertyAssignment(id.parent)
        ? checker.getShorthandAssignmentValueSymbol(id.parent)
        : checker.getSymbolAtLocation(id);
    const ids: ts.Identifier[] = [];
    const calls: ts.CallExpression[] = [];
    let testFromFixtures = false;

    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n)) ids.push(n);
      if (
        (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
        n.moduleSpecifier &&
        ts.isStringLiteral(n.moduleSpecifier)
      ) {
        const from = n.moduleSpecifier.text;
        if (PW.has(from)) {
          for (const v of pwValues(n)) at(n, `從 ${from} 拿了 ${v}`);
        } else if (
          isFixtures(file, from) &&
          ts.isImportDeclaration(n) &&
          !n.importClause?.isTypeOnly
        ) {
          const b = n.importClause?.namedBindings;
          testFromFixtures ||=
            !!b &&
            ts.isNamedImports(b) &&
            b.elements.some((e) => !e.isTypeOnly && (e.propertyName ?? e.name).text === 'test');
        }
      } else if (
        ts.isImportEqualsDeclaration(n) &&
        !n.isTypeOnly &&
        ts.isExternalModuleReference(n.moduleReference)
      ) {
        const e = n.moduleReference.expression;
        if (ts.isStringLiteral(e) && PW.has(e.text)) at(n, `import = require('${e.text}')`);
      } else if (ts.isCallExpression(n)) {
        const [arg] = n.arguments;
        const dynamic =
          n.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(n.expression) && n.expression.text === 'require');
        if (dynamic && !(arg && ts.isStringLiteralLike(arg))) at(n, '動態載入的模組要寫死');
        else if (dynamic && PW.has((arg as ts.StringLiteralLike).text))
          at(n, '動態載入 @playwright/test');
      } else if (ts.isBindingElement(n)) {
        const key = n.propertyName ?? n.name;
        if (ts.isIdentifier(key) && OPENERS.has(key.text))
          at(n, `把 ${key.text} 拆出來，追不到開出來的 context`);
      }
      const m = methodName(n);
      if (m && OPENERS.has(m)) {
        if (ts.isCallExpression(n.parent) && n.parent.expression === n) calls.push(n.parent);
        else at(n, `${m} 沒有直接呼叫，追不到開出來的 context`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);

    if (isTestFile(file) && !testFromFixtures) at(sf, 'test 沒有從 fixtures 拿');

    // 開出來的 context 放進哪個變數：const x = await ...；其他寫法追不到
    const holder = (call: ts.CallExpression): ts.Identifier | undefined => {
      let n: ts.Node = call;
      while (ts.isAwaitExpression(n.parent) || ts.isParenthesizedExpression(n.parent)) n = n.parent;
      const d = n.parent;
      return ts.isVariableDeclaration(d) && d.initializer === n && ts.isIdentifier(d.name)
        ? d.name
        : undefined;
    };
    const contexts = new Set<ts.Symbol>();
    for (const c of calls) {
      const v = methodName(c.expression) !== 'newPage' ? holder(c) : undefined;
      const s = v && symbolOf(v);
      if (s) contexts.add(s);
    }
    // 在 context 上開分頁不另開 context：上面這些變數，與 fixture 的 context（參數拆出來的 context）
    const isContext = (n: ts.Expression): boolean => {
      const s = ts.isIdentifier(n) ? symbolOf(n) : undefined;
      if (!s) return false;
      const d = s.valueDeclaration;
      const key = d && ts.isBindingElement(d) ? (d.propertyName ?? d.name) : undefined;
      return (
        contexts.has(s) ||
        (!!key &&
          ts.isIdentifier(key) &&
          key.text === 'context' &&
          ts.isParameter(d!.parent.parent))
      );
    };
    const isStub = (id: ts.Identifier): boolean => {
      const call = id.parent;
      if (
        !ts.isCallExpression(call) ||
        call.arguments[0] !== id ||
        !ts.isAwaitExpression(call.parent) ||
        !ts.isIdentifier(call.expression)
      )
        return false;
      const d = checker.getSymbolAtLocation(call.expression)?.declarations?.[0];
      if (!d || !ts.isImportSpecifier(d)) return false;
      const from = d.parent.parent.parent.moduleSpecifier;
      return (
        (d.propertyName ?? d.name).text === 'stubVisitorCounter' &&
        ts.isStringLiteral(from) &&
        isFixtures(file, from.text)
      );
    };

    for (const call of calls) {
      const m = methodName(call.expression)!;
      const receiver = (call.expression as ts.PropertyAccessExpression).expression;
      if (m === 'newPage' && isContext(receiver)) continue;
      const v = holder(call);
      if (!v) {
        at(call, `${m} 開的 context 沒有放進 const 變數，追不到有沒有擋計數器`);
        continue;
      }
      opened.push(`${file}:${v.text}`);
      const s = symbolOf(v);
      const first = ids.find((id) => id !== v && symbolOf(id) === s);
      if (!first || !isStub(first)) {
        at(call, `${v.text} 開了 context，第一次用到它要是 await stubVisitorCounter(${v.text})`);
      }
    }
  }
  return { problems, opened };
}

const problems = (sources: Source[]): string[] => scan(sources).problems;
const FIX = "import { test, expect, stubVisitorCounter } from './fixtures';\n";
const PW_SPEC =
  "import { test } from '@playwright/test';\ntest('x', async ({ page }) => { await page.goto('/'); });\n";
const spec = (body: string, file = 'a.spec.ts'): string[] => problems([{ file, text: FIX + body }]);

// testDir 只認 playwright.config.ts 裡唯一一個字串：project 另設 testDir 或改成算出來的，這裡要跟著改
function configTestDir(): string {
  const text = readFileSync(join(QUIZ_APP, 'playwright.config.ts'), 'utf8');
  const found: ts.Expression[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAssignment(n) && n.name.getText() === 'testDir') found.push(n.initializer);
    ts.forEachChild(n, visit);
  };
  visit(ts.createSourceFile('playwright.config.ts', text, ts.ScriptTarget.Latest, true));
  if (found.length !== 1 || !ts.isStringLiteral(found[0])) {
    throw new Error(
      `playwright.config.ts 的 testDir 要是唯一一個字串，現在是 ${found.map((e) => e.getText())}`
    );
  }
  return join(QUIZ_APP, found[0].text);
}

const TEST_DIR = configTestDir();
const real: Source[] = readdirSync(TEST_DIR, { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile())
  .map((d) => relative(TEST_DIR, join(d.parentPath, d.name)).split(sep).join('/'))
  .filter((f) => CODE.test(f) && f !== 'fixtures.ts' && !f.split('/').includes('node_modules'))
  .map((file) => ({ file, text: readFileSync(join(TEST_DIR, file), 'utf8') }));
const realScan = scan(real);

describe('E2E 不連訪客計數器的外部服務', () => {
  it('讀得到 spec 與 helper（反空轉）', () => {
    const files = real.map((s) => s.file);
    // spec 的檔數，不是語料規模：刪 spec 時才要改
    expect(files.filter(isTestFile).length).toBeGreaterThanOrEqual(14);
    expect(files).toEqual(
      expect.arrayContaining([
        'practice-keyboard.spec.ts',
        'home-subtitle.spec.ts',
        'color-math.ts',
      ])
    );
    expect(files).not.toContain('fixtures.ts');
    // 會自己開 context 的三個檔都追到了
    expect(realScan.opened).toEqual(
      expect.arrayContaining([
        'practice-keyboard.spec.ts:context',
        'home-subtitle.spec.ts:context',
        'storage-blocked.spec.ts:context',
      ])
    );
  });

  it('沒有繞過 fixtures 的 test 與 context', () => {
    expect(realScan.problems).toEqual([]);
  });

  it('解析器認得各種寫法', () => {
    expect(
      spec("import {\n  devices as d,\n  test,\n  type Page,\n} from '@playwright/test';")
    ).toEqual(['a.spec.ts:2 從 @playwright/test 拿了 test']);
    expect(spec("import { test as it } from '@playwright/test';")).toHaveLength(1);
    expect(spec("import * as pw from '@playwright/test';")).toHaveLength(1);
    expect(spec("export { test } from '@playwright/test';")).toHaveLength(1);
    expect(spec("export * from '@playwright/test';")).toHaveLength(1);
    expect(spec("const { test: t } = require('@playwright/test');")).toHaveLength(1);
    expect(spec("import pw = require('@playwright/test');")).toHaveLength(1);
    expect(spec("const pw = await import('playwright/test');")).toHaveLength(1);
    expect(spec("const name = '@playwright/test';\nconst pw = await import(name);")).toHaveLength(
      1
    );
    // 沒有 test 的 spec
    expect(problems([{ file: 'a.spec.ts', text: "import { expect } from './fixtures';" }])).toEqual(
      ['a.spec.ts:1 test 沒有從 fixtures 拿']
    );
  });

  it('現有 spec 的寫法不擋', () => {
    expect(
      spec(
        "import type { Locator, Page } from '@playwright/test';\n" +
          "import { devices, chromium, firefox, webkit, type Browser } from '@playwright/test';\n" +
          "async function f(page: import('@playwright/test').Page) {}\n" +
          "test('a', async ({ browser }) => {\n" +
          '  for (const x of [1, 2]) {\n' +
          '    const context = await browser.newContext({});\n' +
          '    await stubVisitorCounter(context);\n' +
          '    const page = await context.newPage();\n' +
          '  }\n' +
          '});\n' +
          "test('b', async () => {\n" +
          "  const context = await chromium.launchPersistentContext('p', {});\n" +
          '  await stubVisitorCounter(context);\n' +
          '  const page = context.pages()[0] ?? (await context.newPage());\n' +
          '});\n' +
          "test('c', async ({ context }) => { const page = await context.newPage(); });\n" +
          "test('d', async ({ browser }) => {\n" +
          '  const page = await browser.newPage();\n' +
          '  await stubVisitorCounter(page);\n' +
          '});'
      )
    ).toEqual([]);
    expect(
      problems([
        { file: 'sub/a.spec.ts', text: "import { test } from '../fixtures';" },
        { file: 'helper.ts', text: "import type { Page } from '@playwright/test';" },
      ])
    ).toEqual([]);
  });

  it('自己開的 context 每一個都要先擋', () => {
    const open = (body: string): string[] =>
      spec(`test('x', async ({ browser, page }) => {\n${body}\n});`);
    // 擋晚了、沒有 await、擋的是另一個同名變數、stubVisitorCounter 不是 fixtures 的
    expect(
      open(
        'const c = await browser.newContext();\nawait c.newPage();\nawait stubVisitorCounter(c);'
      )
    ).toHaveLength(1);
    expect(open('const c = await browser.newContext();\nstubVisitorCounter(c);')).toHaveLength(1);
    expect(
      open(
        'const c = await browser.newContext();\n{ const c = page; await stubVisitorCounter(c); }'
      )
    ).toHaveLength(1);
    expect(
      problems([
        {
          file: 'a.ts',
          text:
            'async function stubVisitorCounter(x: unknown) {}\n' +
            'const c = await browser.newContext();\nawait stubVisitorCounter(c);',
        },
      ])
    ).toHaveLength(1);
    // 追不到的寫法
    expect(
      open('let c;\nc = await browser.newContext();\nawait stubVisitorCounter(c);')
    ).toHaveLength(1);
    expect(
      open('const p = await (await browser.newContext()).newPage();\nawait stubVisitorCounter(p);')
    ).not.toEqual([]);
    expect(open("const c = await browser['newContext']();")).toHaveLength(1);
    expect(open('const f = browser.newContext.bind(browser);')).toHaveLength(1);
    expect(open('const { newContext } = browser;')).toHaveLength(1);
  });
});

describe('審查找到的繞過寫法都要擋下', () => {
  it('B1：./fixtures 旁邊再 default import @playwright/test', () => {
    expect(
      spec("import pwTest from '@playwright/test';\npwTest('x', async () => {});")
    ).not.toEqual([]);
  });
  it('B2：browser.newPage() 也開了 context', () => {
    expect(
      spec(
        "test('x', async ({ browser }) => { const p = await browser.newPage(); await p.goto('/'); });"
      )
    ).not.toEqual([]);
  });
  it('B3 到 B6：子資料夾、.spec.tsx、.spec.js、.test.ts 都是 Playwright 會跑的檔', () => {
    for (const file of ['sub/x.spec.ts', 'x.spec.tsx', 'x.spec.js', 'x.test.ts']) {
      expect(isTestFile(file), file).toBe(true);
      expect(problems([{ file, text: PW_SPEC }]), file).not.toEqual([]);
    }
  });
  it('B7：helper 模組開 context', () => {
    expect(
      problems([
        {
          file: 'helpers.ts',
          text: "import type { Browser } from '@playwright/test';\nexport const openCtx = (b: Browser) => b.newContext();\n",
        },
      ])
    ).not.toEqual([]);
  });
  it('B8：擋的是 fixture 的 page，自己開的 context 沒擋（次數相同）', () => {
    expect(
      spec(
        "test('x', async ({ browser, page }) => { await stubVisitorCounter(page); const c = await browser.newContext(); await (await c.newPage()).goto('/'); });"
      )
    ).not.toEqual([]);
  });
  it('B9：dynamic import @playwright/test', () => {
    expect(
      spec("const { test: dyn } = await import('@playwright/test');\ndyn('x', async () => {});")
    ).not.toEqual([]);
  });
});
