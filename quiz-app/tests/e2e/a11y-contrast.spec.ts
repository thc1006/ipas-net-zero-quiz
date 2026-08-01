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
    const sFg = parseColor(c.successFg, `${c.mode} success-fg`);
    const eFg = parseColor(c.errorFg, `${c.mode} error-fg`);
    const sSol = parseColor(c.successSolid, `${c.mode} success-solid`);
    const eSol = parseColor(c.errorSolid, `${c.mode} error-solid`);
    const onS = parseColor(c.onSuccess, `${c.mode} on-success`);
    const onE = parseColor(c.onError, `${c.mode} on-error`);
    const sTint = alphaOver(c.successBg, surf, `${c.mode} success-bg`);
    const eTint = alphaOver(c.errorBg, surf, `${c.mode} error-bg`);
    // tint 也可能疊在「page background」上（如首頁 .badge-success 的 ancestor 皆透明），
    // 那比疊在白 surface 上對比更低 —— 一定要驗這一種，否則會像上一版誤綠。
    const sTintPage = alphaOver(c.successBg, bg, `${c.mode} success-bg/page`);
    const eTintPage = alphaOver(c.errorBg, bg, `${c.mode} error-bg/page`);
    const sScore = gradientStops(c.successScore, `${c.mode} success-score`);
    const eScore = gradientStops(c.errorScore, `${c.mode} error-score`);

    // -fg 文字放在所有可能背景上 >= 4.5:1
    const successBgs: [number[], string][] = [
      [surf, 'surface'],
      [surfV, 'surface-variant'],
      [bg, 'page-background'],
      [sTint, 'success-tint'],
      [sTintPage, 'success-tint-over-page'],
      ...sScore.map((g, i): [number[], string] => [g, `success-score#${i}`]),
    ];
    for (const [b, name] of successBgs) {
      expect
        .soft(contrast(sFg, b), `${c.mode} success-fg on ${name}`)
        .toBeGreaterThanOrEqual(4.5);
    }
    const errorBgs: [number[], string][] = [
      [surf, 'surface'],
      [surfV, 'surface-variant'],
      [bg, 'page-background'],
      [eTint, 'error-tint'],
      [eTintPage, 'error-tint-over-page'],
      ...eScore.map((g, i): [number[], string] => [g, `error-score#${i}`]),
    ];
    for (const [b, name] of errorBgs) {
      expect
        .soft(contrast(eFg, b), `${c.mode} error-fg on ${name}`)
        .toBeGreaterThanOrEqual(4.5);
    }

    // 徽章/標頭：on-color 白字放在 -solid 實填上 >= 4.5:1
    expect
      .soft(contrast(onS, sSol), `${c.mode} on-success on success-solid`)
      .toBeGreaterThanOrEqual(4.5);
    expect
      .soft(contrast(onE, eSol), `${c.mode} on-error on error-solid`)
      .toBeGreaterThanOrEqual(4.5);
  }
});

