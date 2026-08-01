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
/** fail-closed：缺值/無法解析/**帶 alpha（非不透明）**一律丟錯 —— 不把 rgba(0,0,0,.01)
 * 靜默當成不透明黑、也不把含 alpha 的 hex 當不透明。本函式只用於「應為不透明」的色
 * （surface/fg/solid/on/gradient stop）；帶 alpha 的 tint 走 alphaOver 做合成。 */
function parseColor(s: string, label: string): number[] {
  const t = (s ?? '').trim();
  if (!t) throw new Error(`Missing color token: ${label}`);
  const hex = t.match(/^#([0-9a-fA-F]+)$/);
  if (hex) {
    const h = hex[1];
    if (h.length === 6) return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    if (h.length === 3) return [0, 1, 2].map((i) => parseInt(h[i] + h[i], 16));
    // 4 / 8 碼 hex 含 alpha → fail-closed
    throw new Error(`Non-opaque or invalid hex for ${label}: "${t}"`);
  }
  const m = t.match(/^rgba?\(\s*([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(',').map((x) => parseFloat(x));
    // arity 必須是 3 或 4；否則不接受（避免 rgb(1,2,3,4,5) 之類被誤解析）
    if ((p.length === 3 || p.length === 4) && p.every((n) => Number.isFinite(n))) {
      // channel 範圍：瀏覽器會把超界值 clamp（rgb(999,0,0)→255），若不驗會測到假高對比、與實際渲染不符
      if (p.slice(0, 3).some((v) => v < 0 || v > 255)) {
        throw new Error(`RGB channel out of 0–255 for ${label}: "${t}"`);
      }
      const a = p.length === 4 ? p[3] : 1;
      if (a < 0 || a > 1) {
        throw new Error(`Alpha out of 0–1 for ${label}: "${t}"`);
      }
      if (a !== 1) {
        throw new Error(`Non-opaque color where opaque expected for ${label}: "${t}"`);
      }
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
/** 逗號切分但尊重 rgb()/hsl() 內層括號（供 gradient stop 解析） */
function splitTopLevel(str: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** gradient 單一 stop → 不透明 rgb：半透明 stop（如衍生分數卡的 tint 端點）疊在 backdrop 上；
 * 不透明 stop（hex / rgb / rgba a=1）走 fail-closed parseColor。 */
function resolveStop(tok: string, backdrop: number[], label: string): number[] {
  const m = tok.match(/^rgba?\(\s*([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(',').map((x) => parseFloat(x));
    const a = p.length >= 4 ? p[3] : 1;
    if (p.length >= 3 && p.slice(0, 3).every((n) => Number.isFinite(n)) && a !== 1) {
      return alphaOver(tok, backdrop, label); // 半透明 → 疊底
    }
  }
  return parseColor(tok, label); // 不透明
}

/** 從 gradient 抽出**所有** color stop（不只 hex）。半透明 stop（衍生分數卡的 tint 端點）疊在
 * backdrop（分數卡背後的 page-background）上再算對比；無法解析的 segment（如具名色）丟錯 ——
 * 不靜默漏掉低對比 stop。第一段若無顏色視為方向（135deg / to right）。 */
function gradientStops(g: string, label: string, backdrop: number[]): number[][] {
  const s = (g ?? '').trim();
  const m = s.match(/^(?:repeating-)?(?:linear|radial|conic)-gradient\(([\s\S]*)\)$/i);
  if (!m) throw new Error(`Not a gradient for ${label}: "${s}"`);
  const stops: number[][] = [];
  for (const seg of splitTopLevel(m[1])) {
    const t = seg.trim();
    if (!t) continue;
    const cm = t.match(/^(#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla)\([^)]*\))/i);
    if (!cm) {
      // 只有「明確方向語法」的第一段才可略過；其他無法解析的段（如具名色 green）一律 fail-closed，
      // 不再把非方向的第一段當方向跳過（否則 linear-gradient(green, #fff, #fff) 會漏掉 green 這個 stop）
      const isDirection =
        stops.length === 0 &&
        /^(-?\d*\.?\d+(?:deg|rad|grad|turn)|to\s+(?:left|right|top|bottom)(?:\s+(?:left|right|top|bottom))?)$/i.test(
          t
        );
      if (isDirection) continue;
      throw new Error(`Gradient segment without parseable color for ${label}: "${t}"`);
    }
    stops.push(resolveStop(cm[1], backdrop, `${label} stop "${cm[1]}"`));
  }
  if (stops.length < 2) {
    throw new Error(`Expected >= 2 color stops in gradient for ${label}: "${s}"`);
  }
  return stops;
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
        ...gradientStops(r.score, `${c.mode} ${r.name}-score`, bg).map(
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

// #113 的核心不是只有對比，而是「分數卡背景要跟著 CVD remap」。上面的對比矩陣即使把 -score
// 改回固定但高對比的灰色仍會全綠，抓不到這個回歸；故這裡直接斷言 computed backgroundImage 的變化。
test('分數卡背景隨 CVD remap：good/fail 換色、excellent/pass 不變（#113）', async ({
  page,
}) => {
  await page.goto('/');
  // CSS 全域打包，任一頁都載得到 .score-section；注入四張卡後讀 computed backgroundImage。
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.id = 'score-remap-probe';
    d.innerHTML = ['good', 'fail', 'excellent', 'pass']
      .map((c) => `<div class="score-section ${c}"></div>`)
      .join('');
    document.body.appendChild(d);
  });
  // set 與 read 分兩次 evaluate，讓 style recalc 完成（避免同一拍讀到舊值）
  const grads = async (cvd: string): Promise<Record<string, string>> => {
    await page.evaluate(
      (m) => document.documentElement.setAttribute('data-cvd-mode', m),
      cvd
    );
    return page.evaluate(() => {
      const out: Record<string, string> = {};
      for (const c of ['good', 'fail', 'excellent', 'pass']) {
        out[c] = getComputedStyle(
          document.querySelector(`.score-section.${c}`) as HTMLElement
        ).backgroundImage;
      }
      return out;
    });
  };
  const none = await grads('none');
  const prot = await grads('protanopia');
  await page.evaluate(() => {
    document.getElementById('score-remap-probe')?.remove();
    document.documentElement.setAttribute('data-cvd-mode', 'none');
  });

  // 必須是漸層（防止把 -score 改回固定色卻仍「不同」的假象）
  expect(none.good).toContain('gradient');
  expect(none.fail).toContain('gradient');
  // good/fail（success/error）受 CVD remap → 背景必須不同
  expect(none.good, 'good 分數卡背景應隨 CVD 換色').not.toBe(prot.good);
  expect(none.fail, 'fail 分數卡背景應隨 CVD 換色').not.toBe(prot.fail);
  // excellent/pass（warning/info）依設計不受 CVD 影響 → 必須相同
  expect(prot.excellent, 'excellent 不應隨 CVD 改變').toBe(none.excellent);
  expect(prot.pass, 'pass 不應隨 CVD 改變').toBe(none.pass);
});

