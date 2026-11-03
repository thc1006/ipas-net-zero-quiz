// E2E 不可以連到頁尾訪客計數器的外部服務（tests/e2e/fixtures.ts 說明原因）。擋法是 fixtures.ts 的 test：
// 它開的每個 context 都先把計數器的請求回成固定值。這裡守兩件事：每個 spec 的 test 都從 ./fixtures 來，
// 不直接拿 @playwright/test 的；spec 自己開的 context（newContext、launchPersistentContext）也有擋，
// 也就是每個檔案呼叫 stubVisitorCounter 的次數不少於自己開 context 的次數。
// 用 TypeScript 的 parser 找 import 與呼叫：import 換行、型別與值混著 import，regex 都容易漏
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const E2E = join(__dirname, '..', 'tests', 'e2e');

interface SpecFacts {
  /** import 了 test 的模組 */
  testFrom: string[];
  /** 自己開 context 的次數 */
  contexts: number;
  /** stubVisitorCounter(...) 的次數 */
  stubs: number;
}

function specFacts(fileName: string, text: string): SpecFacts {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const facts: SpecFacts = { testFrom: [], contexts: 0, stubs: 0 };
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const bindings = n.importClause?.namedBindings;
      // import * as pw from '@playwright/test' 也拿得到 test
      const names =
        bindings && ts.isNamedImports(bindings)
          ? bindings.elements.map((e) => (e.propertyName ?? e.name).text)
          : bindings
            ? ['test']
            : [];
      if (names.includes('test')) facts.testFrom.push(n.moduleSpecifier.text);
    } else if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : '';
      if (name === 'newContext' || name === 'launchPersistentContext') facts.contexts++;
      if (name === 'stubVisitorCounter') facts.stubs++;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return facts;
}

const specs = readdirSync(E2E)
  .filter((f) => f.endsWith('.spec.ts'))
  .map((f) => ({ file: f, ...specFacts(f, readFileSync(join(E2E, f), 'utf8')) }));

describe('E2E 不連訪客計數器的外部服務', () => {
  it('讀得到 spec（反空轉：會自己開 context 的兩個檔都在）', () => {
    const files = specs.map((s) => s.file);
    expect(files).toContain('practice-keyboard.spec.ts');
    expect(files).toContain('home-subtitle.spec.ts');
    expect(specs.find((s) => s.file === 'practice-keyboard.spec.ts')!.contexts).toBeGreaterThan(0);
  });

  it('每個 spec 的 test 都從 ./fixtures 來', () => {
    expect(
      specs
        .filter((s) => s.testFrom.join() !== './fixtures')
        .map((s) => `${s.file}：${s.testFrom.join() || '沒有 import test'}`)
    ).toEqual([]);
  });

  it('spec 自己開的 context 也擋了計數器', () => {
    expect(
      specs
        .filter((s) => s.stubs < s.contexts)
        .map((s) => `${s.file}：開了 ${s.contexts} 次，擋了 ${s.stubs} 次`)
    ).toEqual([]);
  });

  it('解析器認得各種寫法', () => {
    expect(
      specFacts('a.ts', "import {\n  expect,\n  test,\n  type Page,\n} from '@playwright/test';")
        .testFrom
    ).toEqual(['@playwright/test']);
    expect(specFacts('a.ts', "import { test as it } from '@playwright/test';").testFrom).toEqual([
      '@playwright/test',
    ]);
    expect(specFacts('a.ts', "import * as pw from '@playwright/test';").testFrom).toEqual([
      '@playwright/test',
    ]);
    expect(
      specFacts('a.ts', "import { expect, devices } from '@playwright/test';").testFrom
    ).toEqual([]);
    expect(
      specFacts(
        'a.ts',
        'const c = await browser.newContext({}); await chromium.launchPersistentContext(p, {});'
      ).contexts
    ).toBe(2);
    expect(specFacts('a.ts', 'await stubVisitorCounter(context);').stubs).toBe(1);
  });
});
