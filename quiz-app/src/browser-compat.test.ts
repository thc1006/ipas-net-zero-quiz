// 執行期的程式碼不可以用 Safari 14 不支援的 regex 語法。
//
// build target 是 Vite 6 的預設（'modules'：es2020、safari14 等）。esbuild 會把 lookbehind（「(?<=」「(?<!」）
// 與 d、v 旗標的字面值降級成執行期的 new RegExp(...)，在不支援的瀏覽器一執行就丟 SyntaxError；
// modifiers（「(?i:」）與重複的具名群組不降級，原樣留在 bundle 裡，Safari 14 連整份 bundle 都解析不了。
// 2026-09 修小數點時，normalizeText 的第一版用了 lookbehind（審查時擋下，沒有合併）—— 每一條開始測驗的路徑
// 都經過它，iOS 16.4 以前的 iPhone 上會連測驗都開不起來；vitest 跑在 Node、Playwright 的 WebKit 是新版，
// 兩邊都看不出來。
//
// 失敗即關閉：src 底下每一個不是測試的檔案都檢查，不去猜哪些檔會被 import。先前用 regex 走 import，
// 「./x.js」、新加的 alias、import 句子裡帶引號的註解、關鍵字後面沒空白，都會讓檔案安靜地漏掉。
// 只給測試用的檔案明列在 TEST_ONLY，而且執行期的檔案一個字都不能提到它們。
// regex 用 TypeScript 的 parser 找：字面值、RegExp(...) 的參數、match／matchAll／search 的參數（字串會在執行期
// 被當成 new RegExp）；參數讀不到內容的，明列在 DYNAMIC 並寫明為什麼安全。路徑不是字面值的 import(...) 與
// import.meta.glob 不准出現：兩者都能不寫出檔名就把檔案拉進 bundle。
// 只認一般寫法；s['match'](...)、(s.match)(...)、把 RegExp 指給別的名字（const R = RegExp）、
// Reflect.construct(RegExp, ...)、String.prototype.match.call(s, ...) 這類刻意的繞法不在範圍內
// （本 repo 不會自然寫出來，靠 code review）。
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';

const SRC = __dirname;

// 只給測試用、可以不受限的檔案（相對於 src）→ 為什麼
const TEST_ONLY: Record<string, string> = {
  'utils/explanation-hygiene.ts': '資料層 gate 用它檢查解析文字，只有 *.test.ts 會 import',
};

// 參數讀不到內容的 RegExp(...)、match／matchAll／search 呼叫：檔案 → 那個參數的原始碼 → 為什麼安全
const DYNAMIC: Record<string, Record<string, string>> = {
  'pages/ResultPage.tsx': { "String.fromCharCode(10) + '{2,}'": '內容固定是「兩個以上的換行」' },
  'utils/pinned-laws.ts': {
    'CLAUSE_PATTERN.source': '同一個檔的 regex 字面值 CLAUSE_PATTERN，這裡已經檢查過它',
    g: 'clauseKeys 的 text.match(g)：g 是上一行的 new RegExp(CLAUSE_PATTERN.source)，就是上面那一條',
  },
};

const isTest = (rel: string): boolean =>
  /\.test\.[cm]?[jt]sx?$/.test(rel) || rel === 'test-setup.ts';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = join(dir, d.name);
    if (d.isDirectory()) return sourceFiles(full);
    return /\.[cm]?[jt]sx?$/.test(d.name) ? [relative(SRC, full).replace(/\\/g, '/')] : [];
  });
}

/** regex 裡 Safari 14 不支援的語法；空陣列表示沒有。 */
export function unsupportedSyntax(pattern: string, flags: string): string[] {
  const found: string[] = [];
  for (const f of flags) if (f === 'd' || f === 'v') found.push(`${f} 旗標`);
  const names: string[] = [];
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') {
      i++; // 跳過被跳脫的字元：「\(?<=」不是 lookbehind
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') {
      inClass = true; // 字元類別裡的「(?<=」只是字元
      continue;
    }
    if (c !== '(' || pattern[i + 1] !== '?') continue;
    const rest = pattern.slice(i + 2);
    if (rest.startsWith('<=') || rest.startsWith('<!')) found.push('lookbehind');
    else if (rest.startsWith('<')) names.push(rest.slice(1, rest.indexOf('>')));
    else if (!rest.startsWith(':') && /^[a-z]*(?:-[a-z]*)?:/i.test(rest)) found.push('modifiers');
  }
  const duplicated = names.filter((n, k) => names.indexOf(n) !== k);
  if (duplicated.length > 0) found.push(`重複的具名群組 ${[...new Set(duplicated)].join('、')}`);
  return found;
}

interface Scan {
  regexes: { pattern: string; flags: string; line: number }[];
  dynamic: string[]; // 讀不到內容的參數原始碼
  dynamicImports: string[]; // 路徑不是字面值的 import(...)：會把哪些檔拉進 bundle，靜態看不出來
}

/** 用 TypeScript 的 parser 找出一個檔案裡所有的 regex（註解與一般字串不算）。 */
export function scanRegexes(fileName: string, text: string): Scan {
  const kind = /x$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const scan: Scan = { regexes: [], dynamic: [], dynamicImports: [] };
  const line = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const literal = (n: ts.Expression | undefined): string | undefined => {
    if (n === undefined) return '';
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    if (
      ts.isTaggedTemplateExpression(n) &&
      n.tag.getText(sf) === 'String.raw' &&
      ts.isNoSubstitutionTemplateLiteral(n.template)
    ) {
      return n.template.rawText ?? n.template.text;
    }
    return undefined;
  };
  const visit = (n: ts.Node): void => {
    if (n.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      const t = n.getText(sf);
      const end = t.lastIndexOf('/');
      scan.regexes.push({ pattern: t.slice(1, end), flags: t.slice(end + 1), line: line(n) });
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [spec] = n.arguments;
      if (spec === undefined || literal(spec) === undefined)
        scan.dynamicImports.push(n.getText(sf));
    } else if (ts.isNewExpression(n) || ts.isCallExpression(n)) {
      const callee = n.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : '';
      if (name === 'RegExp') {
        const [p, f] = n.arguments ?? [];
        const pattern = literal(p);
        const flags = literal(f);
        if (pattern === undefined) scan.dynamic.push(p!.getText(sf));
        if (flags === undefined) scan.dynamic.push(f!.getText(sf));
        scan.regexes.push({ pattern: pattern ?? '', flags: flags ?? '', line: line(n) });
      } else if (
        ['match', 'matchAll', 'search'].includes(name) &&
        ts.isPropertyAccessExpression(callee)
      ) {
        // 字串參數會在執行期被當成 new RegExp(字串)。regex 字面值另外會被掃到；其他讀不到內容的（變數、
        // 帶 ${} 的模板字串、字串串接）比照 RegExp(...) 列進 DYNAMIC：看不出它是字串還是 regex
        const [p] = n.arguments ?? [];
        if (p !== undefined && !ts.isRegularExpressionLiteral(p)) {
          const pattern = literal(p);
          if (pattern === undefined) scan.dynamic.push(p.getText(sf));
          else scan.regexes.push({ pattern, flags: '', line: line(n) });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return scan;
}

describe('偵測本身有效（該擋的擋、不該擋的放行）', () => {
  it.each([
    [String.raw`(?<=\d)\.`, '', 'lookbehind'],
    ['(?<!費率)', '', 'lookbehind'],
    ['(?i:abc)', '', 'modifiers'],
    ['(?-i:abc)', '', 'modifiers'],
    ['(?i-m:abc)', '', 'modifiers'],
    ['(?i-:abc)', '', 'modifiers'],
    ['(?ims-:abc)', '', 'modifiers'],
    ['a', 'gd', 'd 旗標'],
    [String.raw`[\p{L}--\p{Lu}]`, 'v', 'v 旗標'],
    [String.raw`(?<y>\d{4})|(?<y>\d{2})`, '', '重複的具名群組 y'],
  ])('擋：/%s/%s（%s）', (pattern, flags, what) => {
    expect(unsupportedSyntax(pattern, flags)).toEqual([what]);
  });

  it.each([
    [String.raw`(?<year>\d{4})`, 'u'], // 具名群組不是 lookbehind
    ['(?:abc)', 'g'],
    ['(?=abc)', ''],
    ['(?!abc)', ''],
    [String.raw`\(?<=`, ''], // 跳脫的括號
    ['[(?<=]', ''], // 字元類別裡的字元
    [String.raw`[\]](?:x)`, ''], // 類別裡跳脫的 ]
    ['a', 'gimsuy'],
  ])('放行：/%s/%s', (pattern, flags) => {
    expect(unsupportedSyntax(pattern, flags)).toEqual([]);
  });

  it('parser 找得到每一種寫法，註解與一般字串不算', () => {
    const text = [
      'const a = /(?<=x)y/g;',
      "const b = new RegExp('(?<!x)');",
      "const c = RegExp(String.raw`(?<=\\d)`, 'u');",
      "const d = new window.RegExp('(?i:x)');",
      'const e = <div title="/(?<=x)/">{/(?<=z)/.test(s) ? 1 : 0}</div>;',
      '// const f = /(?<=comment)/;',
      "const g = '(?<=just a string)';",
      "const h = s.match('(?<=m)');",
      'const k = [...s.matchAll(`(?<=n)`)];',
      "const l = s.search('(?<=o)') + s.match(re).length + s.replace('(?<=p)', '');",
    ].join('\n');
    const { regexes, dynamic } = scanRegexes('x.tsx', text);
    expect(regexes.map((r) => [r.pattern, r.flags, r.line])).toEqual([
      ['(?<=x)y', 'g', 1],
      ['(?<!x)', '', 2],
      [String.raw`(?<=\d)`, 'u', 3],
      ['(?i:x)', '', 4],
      ['(?<=z)', '', 5],
      ['(?<=m)', '', 8],
      ['(?<=n)', '', 9],
      ['(?<=o)', '', 10], // replace 的字串參數是字面比對，不是 regex
    ]);
    expect(dynamic).toEqual(['re']); // match(re)：讀不到 re 是字串還是 regex，要列進 DYNAMIC
  });

  it('match／matchAll／search 的參數讀不到內容時要回報（字串會在執行期變成 regex）', () => {
    const text = [
      's.match(`(?<=${k})x`);',
      "const P = '(?<=x)y'; s.search(P);",
      "s.match('(?<=' + 'x)y');",
      's.matchAll(String.raw`(?<=${k})\\d`);',
      's.match(/(?<=x)/);',
      's.match();',
    ].join('\n');
    const { regexes, dynamic } = scanRegexes('x.ts', text);
    expect(dynamic).toEqual(['`(?<=${k})x`', 'P', "'(?<=' + 'x)y'", 'String.raw`(?<=${k})\\d`']);
    expect(regexes.map((r) => r.pattern)).toEqual(['(?<=x)']); // regex 字面值照常檢查
  });

  it('路徑不是字面值的動態 import 要回報（它可以不寫出檔名就把檔案拉進 bundle）', () => {
    const text =
      "import('./a');\nimport(`./b`);\nimport(`./utils/explanation-${k}.ts`);\nimport(path);";
    expect(scanRegexes('x.ts', text).dynamicImports).toEqual([
      'import(`./utils/explanation-${k}.ts`)',
      'import(path)',
    ]);
  });

  it('參數不是字面值的 RegExp 呼叫要回報，讀不到的旗標也是', () => {
    const { regexes, dynamic } = scanRegexes('x.ts', "new RegExp(p);\nnew RegExp('a', flags);");
    expect(dynamic).toEqual(['p', 'flags']);
    expect(regexes.map((r) => r.pattern)).toEqual(['', 'a']);
  });
});

describe('執行期的程式碼不可以用 Safari 14 不支援的 regex 語法', () => {
  const all = sourceFiles(SRC);
  const runtime = all.filter((f) => !isTest(f) && !(f in TEST_ONLY));
  const scans = new Map(
    runtime.map((f) => [f, scanRegexes(f, readFileSync(join(SRC, f), 'utf8'))])
  );

  it('這條 gate 不能空轉：每一個非測試的檔案都在，包括每次開始測驗都會用到的 normalizeText', () => {
    expect(runtime).toContain('main.tsx');
    expect(runtime).toContain('utils/question-identity.ts');
    expect(runtime.filter(isTest)).toEqual([]);
    expect(scans.get('utils/question-identity.ts')!.regexes.length).toBeGreaterThan(0);
  });

  it('執行期的每一個檔案都沒有不支援的 regex 語法', () => {
    const bad = [...scans].flatMap(([f, s]) =>
      s.regexes.flatMap((r) =>
        unsupportedSyntax(r.pattern, r.flags).map((what) => `${f}:${r.line} ${what}`)
      )
    );
    expect(bad, '改用 replacer 函式，或先比對再判斷前後的字').toEqual([]);
  });

  it('讀不到內容的 RegExp 呼叫都要列在 DYNAMIC，列了的也都還在', () => {
    const found = Object.fromEntries(
      [...scans].filter(([, s]) => s.dynamic.length > 0).map(([f, s]) => [f, [...s.dynamic].sort()])
    );
    const listed = Object.fromEntries(
      Object.entries(DYNAMIC).map(([f, m]) => [f, Object.keys(m).sort()])
    );
    expect(found).toEqual(listed);
  });

  it('TEST_ONLY 的每一個檔都真的需要豁免，而且執行期的檔案不會用到它', () => {
    for (const f of Object.keys(TEST_ONLY)) {
      expect(all, `${f} 不存在`).toContain(f);
      const s = scanRegexes(f, readFileSync(join(SRC, f), 'utf8'));
      const needs = s.regexes.some((r) => unsupportedSyntax(r.pattern, r.flags).length > 0);
      expect(needs, `${f} 沒有不支援的語法 —— 不需要豁免，從 TEST_ONLY 拿掉`).toBe(true);
      // 用名字找而不是解析 import：任何 import 寫法（./x.js、alias、動態 import）都會寫出這個名字
      const name = f.replace(/^.*\//, '').replace(/\.[cm]?[jt]sx?$/, '');
      const users = runtime.filter((r) => readFileSync(join(SRC, r), 'utf8').includes(name));
      expect(users, `執行期的檔案提到了只給測試用的 ${f}`).toEqual([]);
    }
    // import.meta.glob 與路徑不是字面值的 import(...) 不寫出檔名就能把檔案拉進 bundle：出現了就要重新設計這一條
    expect(
      runtime.filter((r) => readFileSync(join(SRC, r), 'utf8').includes('import.meta.glob'))
    ).toEqual([]);
    expect(Object.fromEntries([...scans].filter(([, s]) => s.dynamicImports.length > 0))).toEqual(
      {}
    );
  });
});
