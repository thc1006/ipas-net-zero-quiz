import { test, expect } from '@playwright/test';

/**
 * #109 回歸守門：語意色 role-based token 的值，在 light/dark × 4 種 CVD 模式下都要達 WCAG AA
 * （文字前景／徽章白字皆 4.5:1）。jsdom 算不出 stylesheet 的 CSS 變數，只有真瀏覽器測得到。
 * 任何人把某個 token 改成低對比值，這支測試就會紅。
 */
function relLum([r, g, b]: number[]): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: number[], b: number[]): number {
  const la = relLum(a);
  const lb = relLum(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

test('語意 token 角色值：全 mode×theme 達 WCAG AA（#109 contrast matrix）', async ({
  page,
}) => {
  await page.goto('/');

  const rows = await page.evaluate(() => {
    const html = document.documentElement;
    const parse = (s: string): number[] => {
      const t = s.trim();
      if (t.startsWith('#')) {
        return [1, 3, 5].map((i) => parseInt(t.slice(i, i + 2), 16));
      }
      const m = t.match(/\d+/g) ?? ['0', '0', '0'];
      return [Number(m[0]), Number(m[1]), Number(m[2])];
    };
    const read = (v: string): string =>
      getComputedStyle(html).getPropertyValue(v).trim();
    const combos: [string, string][] = [
      ['light', 'none'],
      ['dark', 'none'],
      ['light', 'protanopia'],
      ['dark', 'protanopia'],
      ['light', 'deuteranopia'],
      ['dark', 'deuteranopia'],
      ['light', 'tritanopia'],
      ['dark', 'tritanopia'],
    ];
    const out = combos.map(([theme, cvd]) => {
      html.setAttribute('data-theme', theme);
      html.setAttribute('data-cvd-mode', cvd);
      return {
        mode: `${theme}/${cvd}`,
        surf: parse(read('--color-surface')),
        successFg: parse(read('--color-success-fg')),
        errorFg: parse(read('--color-error-fg')),
        successSolid: parse(read('--color-success-solid')),
        errorSolid: parse(read('--color-error-solid')),
      };
    });
    html.setAttribute('data-theme', 'light');
    html.setAttribute('data-cvd-mode', 'none');
    return out;
  });

  const WHITE = [255, 255, 255];
  for (const r of rows) {
    // 文字前景在表面上 >= 4.5:1
    expect
      .soft(contrast(r.successFg, r.surf), `${r.mode} success-fg on surface`)
      .toBeGreaterThanOrEqual(4.5);
    expect
      .soft(contrast(r.errorFg, r.surf), `${r.mode} error-fg on surface`)
      .toBeGreaterThanOrEqual(4.5);
    // 徽章白字在實填底上 >= 4.5:1
    expect
      .soft(contrast(WHITE, r.successSolid), `${r.mode} white on success-solid`)
      .toBeGreaterThanOrEqual(4.5);
    expect
      .soft(contrast(WHITE, r.errorSolid), `${r.mode} white on error-solid`)
      .toBeGreaterThanOrEqual(4.5);
  }
});
