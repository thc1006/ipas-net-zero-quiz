// #109 守門：掃描所有 CSS，color:/border* 屬性不得使用「裸」--color-success/error。
// 這類前景/邊界用途必須走 role token（--color-*-fg），否則會像 QuizPage abort button 那樣
// 漏掉 role-token migration、在多個 theme/CVD 組合低於 4.5:1，而 palette 對比測試又抓不到
// （因為它驗的是 token 值、不是「哪個 selector 用了哪個 token」）。
// 裝飾用途（background:/box-shadow: 的 bar、色條）允許裸 token —— 它們沒有文字對比需求。
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

describe('語意 token 用法掃描（a11y #109）', () => {
  it('color/border 屬性不得使用裸 --color-success/error（必須用 --color-*-fg）', () => {
    // 裸 token：var(--color-success) 或 var(--color-success, fallback)，但**不含** -fg/-solid/-bg
    const bareToken = /var\(\s*--color-(?:success|error)\s*(?:,|\))/;
    const fgBorderProp =
      /^\s*(?:color|border|border-color|border-top|border-right|border-bottom|border-left|border-left-color|border-right-color|border-top-color|border-bottom-color|outline|outline-color)\s*:/;
    const violations: string[] = [];
    for (const file of collectCss(join(process.cwd(), 'src'))) {
      const rel = file.slice(file.indexOf('src')).replace(/\\/g, '/');
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, idx) => {
          if (fgBorderProp.test(line) && bareToken.test(line)) {
            violations.push(`${rel}:${idx + 1}  ${line.trim()}`);
          }
        });
    }
    expect(
      violations,
      `以下把「裸」語意 token 當文字/邊界色，應改用 --color-*-fg：\n${violations.join('\n')}`
    ).toEqual([]);
  });
});
