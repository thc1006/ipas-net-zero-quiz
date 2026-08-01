import { test, expect } from '@playwright/test';

/**
 * #109 回歸守門：語意色 role-based token 在**每一種真實前景/背景配對**下都要達 WCAG AA。
 *
 * 這支測試刻意涵蓋「PR #110 第一版漏掉、被外部 review 抓到」的面向：
 *  - -fg 文字不是只放 --color-surface，還會放在 tint、surface-variant、page background、
 *    以及分數卡漸層上 —— 全部都要 >= 4.5:1。
 *  - 徽章/標頭的白字要對 -solid 驗（讀真正的 --color-on-*，不假設是白）。
 *  - high-contrast on/off 也是獨立維度（2 themes × 4 CVD × 2 HC = 16 組）。
 *  - parser fail-closed：token 缺失或無法解析就直接 throw，不用黑色 fallback 假裝高對比。
 * jsdom 算不出 stylesheet 的 CSS 變數，只有真瀏覽器測得到。
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
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** fail-closed：缺值或無法解析直接丟錯，不回黑色 */
function parseColor(s: string, label: string): number[] {
  const t = (s ?? '').trim();
  if (!t) throw new Error(`Missing color token: ${label}`);
  if (/^#[0-9a-fA-F]{6}$/.test(t)) {
    return [1, 3, 5].map((i) => parseInt(t.slice(i, i + 2), 16));
  }
  const m = t.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(',').map((x) => parseFloat(x));
    if (p.length >= 3 && p.slice(0, 3).every((n) => Number.isFinite(n))) {
      return [p[0], p[1], p[2]];
    }
  }
  throw new Error(`Unsupported color value for ${label}: "${t}"`);
}
/** rgba tint 疊在 bg 上的實際色 */
function alphaOver(rgba: string, bg: number[], label: string): number[] {
  const m = (rgba ?? '').match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`Not an rgba value for ${label}: "${rgba}"`);
  const p = m[1].split(',').map((x) => parseFloat(x));
  const a = p.length >= 4 ? p[3] : 1;
  return [p[0], p[1], p[2]].map((c, i) => Math.round(a * c + (1 - a) * bg[i]));
}
/** 從 gradient 字串抽出所有 hex endpoint */
function gradientStops(g: string, label: string): number[][] {
  const hexes = (g ?? '').match(/#[0-9a-fA-F]{6}/g);
  if (!hexes || hexes.length === 0) {
    throw new Error(`No color stops in gradient for ${label}: "${g}"`);
  }
  return hexes.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
}

test('語意 token：每個真實 fg/bg 配對跨 16 組（theme×CVD×HC）達 WCAG AA（#109）', async ({
  page,
}) => {
  await page.goto('/');

  const combos = await page.evaluate(() => {
    const html = document.documentElement;
    const read = (v: string): string =>
      getComputedStyle(html).getPropertyValue(v).trim();
    const rows: Record<string, string>[] = [];
    for (const theme of ['light', 'dark']) {
      for (const cvd of ['none', 'protanopia', 'deuteranopia', 'tritanopia']) {
        for (const hc of ['false', 'true']) {
          html.setAttribute('data-theme', theme);
          html.setAttribute('data-cvd-mode', cvd);
          html.setAttribute('data-high-contrast', hc);
          rows.push({
            mode: `${theme}/${cvd}/hc=${hc}`,
            surface: read('--color-surface'),
            surfaceVariant: read('--color-surface-variant'),
            background: read('--color-background'),
            successFg: read('--color-success-fg'),
            errorFg: read('--color-error-fg'),
            successSolid: read('--color-success-solid'),
            errorSolid: read('--color-error-solid'),
            onSuccess: read('--color-on-success'),
            onError: read('--color-on-error'),
            successBg: read('--color-success-bg'),
            errorBg: read('--color-error-bg'),
            successScore: read('--color-success-score'),
            errorScore: read('--color-error-score'),
            infoFg: read('--color-info-fg'),
            warningFg: read('--color-warning-fg'),
            infoSolid: read('--color-info-solid'),
            warningSolid: read('--color-warning-solid'),
            onInfo: read('--color-on-info'),
            onWarning: read('--color-on-warning'),
            infoBg: read('--color-info-bg'),
            warningBg: read('--color-warning-bg'),
            infoScore: read('--color-info-score'),
            warningScore: read('--color-warning-score'),
          });
        }
      }
    }
    html.setAttribute('data-theme', 'light');
    html.setAttribute('data-cvd-mode', 'none');
    html.setAttribute('data-high-contrast', 'false');
    return rows;
  });

  expect(combos.length).toBe(16);

  for (const c of combos) {
    const surf = parseColor(c.surface, `${c.mode} surface`);
    const surfV = parseColor(c.surfaceVariant, `${c.mode} surface-variant`);
    const bg = parseColor(c.background, `${c.mode} background`);

    // 四個語意角色一起驗（success/error 受 CVD 影響；info/warning 不受、值在各 CVD 相同、
    // 無害地重複驗）。每個角色的 -fg 文字要在 surface、surface-variant、page-background、
    // tint 疊 surface、tint 疊 page-background、以及 score 漸層端點上都 >= 4.5:1；
    // on-color 白字放在 -solid 上也 >= 4.5:1。
    const roles = [
      { name: 'success', fg: c.successFg, solid: c.successSolid, on: c.onSuccess, tintBg: c.successBg, score: c.successScore },
      { name: 'error', fg: c.errorFg, solid: c.errorSolid, on: c.onError, tintBg: c.errorBg, score: c.errorScore },
      { name: 'info', fg: c.infoFg, solid: c.infoSolid, on: c.onInfo, tintBg: c.infoBg, score: c.infoScore },
      { name: 'warning', fg: c.warningFg, solid: c.warningSolid, on: c.onWarning, tintBg: c.warningBg, score: c.warningScore },
    ];
    for (const r of roles) {
      const fg = parseColor(r.fg, `${c.mode} ${r.name}-fg`);
      const sol = parseColor(r.solid, `${c.mode} ${r.name}-solid`);
      const on = parseColor(r.on, `${c.mode} on-${r.name}`);
      const bgs: [number[], string][] = [
        [surf, 'surface'],
        [surfV, 'surface-variant'],
        [bg, 'page-background'],
        [alphaOver(r.tintBg, surf, `${c.mode} ${r.name}-bg`), 'tint'],
        [alphaOver(r.tintBg, bg, `${c.mode} ${r.name}-bg/page`), 'tint-over-page'],
        ...gradientStops(r.score, `${c.mode} ${r.name}-score`).map(
          (g, i): [number[], string] => [g, `score#${i}`]
        ),
      ];
      for (const [b, name] of bgs) {
        expect
          .soft(contrast(fg, b), `${c.mode} ${r.name}-fg on ${name}`)
          .toBeGreaterThanOrEqual(4.5);
      }
      expect
        .soft(contrast(on, sol), `${c.mode} on-${r.name} on ${r.name}-solid`)
        .toBeGreaterThanOrEqual(4.5);
    }
  }
});

