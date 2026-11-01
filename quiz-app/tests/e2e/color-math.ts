/**
 * 顏色差異的計算：CIEDE2000 色差，以及色覺辨認障礙（二色視）看到的顏色。
 * 給 e2e 拿瀏覽器算出來的顏色比「兩種樣式看起來是不是不一樣」，不是 WCAG 的對比（對比只看亮度，
 * 亮度相近、色相不同的兩個顏色對比接近 1，卻一眼分得出來）。
 */

export type RGB = [number, number, number];

const toLinear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const fromLinear = (l: number): number => {
  const c = Math.min(1, Math.max(0, l));
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
};

/** sRGB（0 到 255）→ CIELAB（D65） */
export function toLab([r, g, b]: RGB): RGB {
  const [lr, lg, lb] = [r, g, b].map(toLinear);
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb;
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIEDE2000 色差（kL = kC = kH = 1）。Sharma、Wu、Dalal（2005）的公式與測試資料 */
export function deltaE2000([l1, a1, b1]: RGB, [l2, a2, b2]: RGB): number {
  const rad = Math.PI / 180;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar7 = Math.pow((c1 + c2) / 2, 7);
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + Math.pow(25, 7))));
  const ap1 = (1 + g) * a1;
  const ap2 = (1 + g) * a2;
  const cp1 = Math.hypot(ap1, b1);
  const cp2 = Math.hypot(ap2, b2);
  const hue = (b: number, ap: number): number => {
    if (b === 0 && ap === 0) return 0;
    const h = Math.atan2(b, ap) / rad;
    return h < 0 ? h + 360 : h;
  };
  const hp1 = hue(b1, ap1);
  const hp2 = hue(b2, ap2);
  const dL = l2 - l1;
  const dC = cp2 - cp1;
  let dh = 0;
  if (cp1 * cp2 !== 0) {
    dh = hp2 - hp1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dh / 2) * rad);
  const lBar = (l1 + l2) / 2;
  const cBar = (cp1 + cp2) / 2;
  let hBar = hp1 + hp2;
  if (cp1 * cp2 !== 0) {
    if (Math.abs(hp1 - hp2) <= 180) hBar = (hp1 + hp2) / 2;
    else hBar = hp1 + hp2 < 360 ? (hp1 + hp2 + 360) / 2 : (hp1 + hp2 - 360) / 2;
  }
  const t =
    1 -
    0.17 * Math.cos((hBar - 30) * rad) +
    0.24 * Math.cos(2 * hBar * rad) +
    0.32 * Math.cos((3 * hBar + 6) * rad) -
    0.2 * Math.cos((4 * hBar - 63) * rad);
  const dTheta = 30 * Math.exp(-Math.pow((hBar - 275) / 25, 2));
  const cBarP7 = Math.pow(cBar, 7);
  const rc = 2 * Math.sqrt(cBarP7 / (cBarP7 + Math.pow(25, 7)));
  const sl = 1 + (0.015 * Math.pow(lBar - 50, 2)) / Math.sqrt(20 + Math.pow(lBar - 50, 2));
  const sc = 1 + 0.045 * cBar;
  const sh = 1 + 0.015 * cBar * t;
  const rt = -Math.sin(2 * dTheta * rad) * rc;
  return Math.sqrt(
    Math.pow(dL / sl, 2) + Math.pow(dC / sc, 2) + Math.pow(dH / sh, 2) + rt * (dC / sc) * (dH / sh)
  );
}

/**
 * 二色視（嚴重度 1.0）看到的顏色：Machado、Oliveira、Fernandes（2009）的矩陣，作用在線性 RGB 上。
 * 每一列加起來是 1，灰色看起來還是同一個灰色。
 */
export const CVD_MATRICES: Record<'protanopia' | 'deuteranopia' | 'tritanopia', number[][]> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

export type Vision = 'normal' | keyof typeof CVD_MATRICES;
export const VISIONS: Vision[] = ['normal', 'protanopia', 'deuteranopia', 'tritanopia'];

export function simulate(rgb: RGB, vision: Vision): RGB {
  if (vision === 'normal') return rgb;
  const lin = rgb.map(toLinear);
  const m = CVD_MATRICES[vision];
  return m.map((row) => fromLinear(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2])) as RGB;
}

/** 兩個 sRGB 顏色在某種色覺下的 CIEDE2000 色差 */
export function seenDifference(a: RGB, b: RGB, vision: Vision): number {
  return deltaE2000(toLab(simulate(a, vision)), toLab(simulate(b, vision)));
}

/**
 * getComputedStyle 給的顏色（rgb() 或 rgba()）→ [r, g, b, a]。其他寫法丟錯：
 * 讀不懂就說讀不懂，不猜成黑色。
 */
export function parseComputed(color: string, label: string): [number, number, number, number] {
  const m = (color ?? '').trim().match(/^rgba?\(([^)]+)\)$/i);
  if (!m) throw new Error(`Unsupported computed color for ${label}: "${color}"`);
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if ((parts.length !== 3 && parts.length !== 4) || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Unparseable computed color for ${label}: "${color}"`);
  }
  return [parts[0], parts[1], parts[2], parts.length === 4 ? parts[3] : 1];
}

/** 由外而內一層一層疊上去的背景色（最外層要不透明） */
export function flatten(layers: string[], label: string): RGB {
  let out: RGB | null = null;
  for (const layer of layers) {
    const [r, g, b, a] = parseComputed(layer, label);
    if (out === null) {
      if (a !== 1) throw new Error(`Outermost background is not opaque for ${label}: "${layer}"`);
      out = [r, g, b];
      continue;
    }
    const base: RGB = out;
    out = [r, g, b].map((c, i) => a * c + (1 - a) * base[i]) as RGB;
  }
  if (out === null) throw new Error(`No background layers for ${label}`);
  return out;
}
