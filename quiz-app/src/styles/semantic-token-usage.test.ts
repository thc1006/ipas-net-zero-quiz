// #109/#112 守門：掃描所有 CSS，禁止把「裸」base 語意 token（--color-success/error/info/warning）
// 用在**非明確允許**的地方。前景/邊界（color/border）用裸 base 會低於 4.5:1（如 QuizPage abort
// button 曾漏 migrate）；而裸 base 當**實填背景**（background: var(--color-success); color: white）
// 也正是 #109 的原始缺陷（base 不是白字安全色，那是 -solid 的職責）。
//
// 因此改成「預設禁止、白名單放行」：只有明確列出的裝飾用途（histogram bar、breakdown bar、
// CVD 預覽色條）可以用裸 base token，其餘一律 fail。
//
// 解析方式：不用逐行 regex（單行 rule `.foo { color: var(--color-error); }` 與跨行 shorthand 都會
// 漏抓），改用「大括號深度」宣告解析器 —— 逐字掃、追蹤 { } 巢狀（含 @media/@keyframes）、以 ; 與 }
// 切出每一條宣告並記其 selector。零相依（postcss 不在 dependency 內）。
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function collectCss(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) collectCss(p, out);
    else if (entry.name.endsWith('.css')) out.push(p);
  }
  return out;
}

interface Decl {
  selector: string;
  prop: string;
  value: string;
  line: number;
}

/**
 * 大括號深度解析：回傳每條宣告的 { selector, prop, value, line }。
 * - selector：最內層（排除 @media/@supports 等 at-rule prelude）之 selector 路徑（以空白 join）。
 * - 正確處理單行多宣告、跨行 shorthand、@media/@keyframes 巢狀。
 */
function parseDeclarations(css: string): Decl[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, ''); // 去註解
  const decls: Decl[] = [];
  const stack: string[] = [];
  let buf = '';
  let line = 1;
  const flush = (): void => {
    const s = buf.trim();
    buf = '';
    if (!s) return;
    const ci = s.indexOf(':');
    if (ci === -1) return; // 非宣告
    const prop = s.slice(0, ci).trim().toLowerCase();
    const value = s.slice(ci + 1).trim();
    if (!prop) return;
    const selector = stack.filter((x) => !x.startsWith('@')).join(' ');
    decls.push({ selector, prop, value, line });
  };
  let str: string | null = null; // 目前所在字串的引號字元（' 或 "）
  let paren = 0; // 括號深度（url()/rgb() 等）
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\n') line++;
    // 字串內：一切照字面收集，直到未跳脫的同款引號（含 data-URI 內的 ; { }）
    if (str !== null) {
      buf += ch;
      if (ch === str && src[i - 1] !== '\\') str = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      str = ch;
      buf += ch;
      continue;
    }
    if (ch === '(') {
      paren++;
      buf += ch;
      continue;
    }
    if (ch === ')') {
      if (paren > 0) paren--;
      buf += ch;
      continue;
    }
    if (paren > 0) {
      buf += ch; // 括號內的 ; { } 當字面（未加引號的 data-URI 等）
      continue;
    }
    if (ch === '{') {
      stack.push(buf.trim());
      buf = '';
    } else if (ch === '}') {
      flush(); // 收尾無分號的最後一條
      stack.pop();
    } else if (ch === ';') {
      flush();
    } else {
      buf += ch;
    }
  }
  return decls;
}

// 裸 base token：var(--color-success) 或 var(--color-success, fallback)，**不含** -fg/-solid/-bg/-score/-on
const BARE_BASE = /var\(\s*--color-(?:success|error|info|warning)\s*(?:,|\))/;

// 白名單：唯一允許裸 base token 的裝飾用途，以「檔名 + 精確 selector + 屬性」比對（非 substring）。
// substring 會誤放行 .pool-histogram__bar-track（含 'bar' 前綴），或同組其他 selector
// （如 `.pool-histogram__bar, .danger { background: var(--color-success) }` 整組被放行）。
const ALLOW: { file: string; selector: string; prop: string }[] = [
  { file: 'PracticePoolHistogram.css', selector: '.pool-histogram__row--main .pool-histogram__bar', prop: 'background' },
  { file: 'PracticePoolHistogram.css', selector: '.pool-histogram__row--mock .pool-histogram__bar', prop: 'background' },
  { file: 'PracticePoolHistogram.css', selector: '.pool-histogram__row--ai .pool-histogram__bar', prop: 'background' },
  { file: 'SourceBreakdown.css', selector: '.source-breakdown__row--main .source-breakdown__bar', prop: 'background' },
  { file: 'SourceBreakdown.css', selector: '.source-breakdown__row--mock .source-breakdown__bar', prop: 'background' },
  { file: 'SourceBreakdown.css', selector: '.source-breakdown__row--ai .source-breakdown__bar', prop: 'background' },
  { file: 'SourceBreakdown.css', selector: '.source-breakdown__row--low .source-breakdown__bar', prop: 'background' },
  // CVD 預覽左側實色條（#112 仍吃裸 base；#113/#114 會改 -fg 後移除這兩條）
  { file: 'SettingsPage.css', selector: '.cvd-preview__chip--correct', prop: 'box-shadow' },
  { file: 'SettingsPage.css', selector: '.cvd-preview__chip--incorrect', prop: 'box-shadow' },
];

const normSel = (s: string): string => s.replace(/\s+/g, ' ').trim();

describe('語意 token 用法掃描（a11y #109/#112）', () => {
  it('裸 --color-success/error/info/warning 只能用於白名單裝飾用途，其餘一律禁止', () => {
    const violations: string[] = [];
    for (const file of collectCss(join(process.cwd(), 'src'))) {
      const rel = file.slice(file.indexOf('src')).replace(/\\/g, '/');
      for (const d of parseDeclarations(readFileSync(file, 'utf8'))) {
        if (!BARE_BASE.test(d.value)) continue;
        const allowed = ALLOW.some(
          (a) =>
            rel.endsWith('/' + a.file) &&
            normSel(d.selector) === a.selector &&
            d.prop === a.prop
        );
        if (!allowed) {
          violations.push(`${rel}:${d.line}  {${d.selector}} ${d.prop}: ${d.value}`);
        }
      }
    }
    expect(
      violations,
      `以下用了「裸」base 語意 token 但不在裝飾白名單內。` +
        `前景/邊界請改 --color-*-fg；實填背景請改 --color-*-solid（＋on-color）：\n${violations.join('\n')}`
    ).toEqual([]);
  });
});
