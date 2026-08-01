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
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\n') line++;
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

// 白名單：唯一允許用裸 base token 的裝飾用途（selector 片段 + 屬性）。其餘一律禁止。
// 這些是純色塊/色條，其上沒有文字對比需求。
const ALLOW: { sel: string; prop: string }[] = [
  { sel: 'pool-histogram__bar', prop: 'background' }, // 抽題分布長條
  { sel: 'source-breakdown__bar', prop: 'background' }, // 來源占比長條
  { sel: 'cvd-preview__chip--correct', prop: 'box-shadow' }, // CVD 預覽左側實色條
  { sel: 'cvd-preview__chip--incorrect', prop: 'box-shadow' },
];

describe('語意 token 用法掃描（a11y #109/#112）', () => {
  it('裸 --color-success/error/info/warning 只能用於白名單裝飾用途，其餘一律禁止', () => {
    const violations: string[] = [];
    for (const file of collectCss(join(process.cwd(), 'src'))) {
      const rel = file.slice(file.indexOf('src')).replace(/\\/g, '/');
      for (const d of parseDeclarations(readFileSync(file, 'utf8'))) {
        if (!BARE_BASE.test(d.value)) continue;
        const allowed = ALLOW.some(
          (a) => d.selector.includes(a.sel) && d.prop === a.prop
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
