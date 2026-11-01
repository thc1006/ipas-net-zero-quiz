import { test, expect, type Page } from '@playwright/test';
import {
  deltaE2000,
  flatten,
  parseComputed,
  seenDifference,
  simulate,
  toLab,
  VISIONS,
  type RGB,
} from './color-math';

/**
 * #148：考試模式選了 D，D 用的是正確答案的綠色（淺色主題的框與底、深色主題的框，數值完全相同），
 * 學員看到的就是「系統說答案是 D」。選取的樣式要一眼看得出不是「正確」，也不是「錯誤」。
 *
 * 比的是瀏覽器真的畫出來的顏色：真的頁面、真的選項，16 種顯示設定（深淺色 × 4 種色覺模式 × 高對比），
 * 每一種再用正常色覺與三種二色視各看一次（色覺模式只是使用者自己開的設定，沒開的人也可能是色盲）。
 *
 * 判準是 CIEDE2000 色差（ΔE00）。ΔE00 約 1 是並排比較時剛好看得出的差異。學員看到選取的樣式時，
 * 正確答案的樣式不在旁邊，是拿記憶去比，所以要很多倍：
 *   - 框線與選項代號的實心圓：至少 15。它們是 2px 的線與小圓，細的東西色差要大才看得出來；
 *     舊的樣式在淺色主題的代號圓、深色主題的框線都是 0（同一個顏色）。
 *   - 選項的底色：至少 5。底色是一大塊，大面積的小色差比細線容易看出；正確與錯誤的底色本身
 *     只是 12% 的淡色，所以取 5，不取 15。
 * 正確與錯誤的樣式不改（這兩個判準只約束選取的樣式）。
 */
const MIN_LINE_DELTA = 15;
const MIN_FILL_DELTA = 5;

const THEMES = ['light', 'dark'] as const;
const CVD_MODES = ['none', 'protanopia', 'deuteranopia', 'tritanopia'] as const;
const HC = ['false', 'true'] as const;

function relLum([r, g, b]: RGB): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// 色差公式本身：Sharma、Wu、Dalal（2005）公布的測試資料（第 1、7、13、17、22 組）
test('色差公式與色覺模擬：對得上公布的測試資料，灰色在每一種色覺下都還是灰色', () => {
  const pairs: [RGB, RGB, number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [50, 3.1736, 0.5854], 1.0],
  ];
  for (const [a, b, want] of pairs) {
    expect(deltaE2000(a, b)).toBeCloseTo(want, 3);
  }
  for (const v of VISIONS) {
    const gray = simulate([119, 119, 119], v);
    for (const c of gray) expect(c, v).toBeCloseTo(119, 0);
  }
  // 紅與綠在紅色盲、綠色盲眼中幾乎一樣，正常色覺差很多：模擬真的有作用
  const red: RGB = [200, 60, 40];
  const green: RGB = [90, 140, 40];
  expect(seenDifference(red, green, 'normal')).toBeGreaterThan(30);
  expect(seenDifference(red, green, 'deuteranopia')).toBeLessThan(seenDifference(red, green, 'normal') / 2);
  expect(parseComputed('rgba(1, 2, 3, 0.5)', 'x')).toEqual([1, 2, 3, 0.5]);
  expect(parseComputed('rgb(1 2 3 / 0.25)', 'x')).toEqual([1, 2, 3, 0.25]);
  expect(() => parseComputed('color(srgb 1 0 0)', 'x')).toThrow();
});

interface Styles {
  border: string;
  layers: string[];
  key: string;
  keyText: string;
  text: string;
  hasMark: boolean;
  markFill: string;
  label: string;
}

async function startExamAndPickLast(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('practice-pool-disclosure-seen', '1');
  });
  await page.goto('/');
  await page.getByLabel(/測驗模式/i).selectOption('exam');
  await page.getByRole('button', { name: /開始測驗/i }).click();
  await expect(page.locator('.question-card')).toBeVisible();
  // 轉場會讓 getComputedStyle 讀到兩個顏色之間的中間值
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  await page.locator('.question-options .option-item').last().click();
  await expect(page.locator('.option-item.selected')).toHaveCount(1);
}

/** 選取的那一個選項，以及用它複製出來、換成 correct／incorrect 的兩個選項的樣式（同一個位置、同一份 CSS） */
async function readStates(page: Page, theme: string, cvd: string, hc: string): Promise<Record<string, Styles>> {
  await page.evaluate(
    ([t, c, h]) => {
      const html = document.documentElement;
      html.setAttribute('data-theme', t);
      html.setAttribute('data-cvd-mode', c);
      html.setAttribute('data-high-contrast', h);
    },
    [theme, cvd, hc]
  );
  return page.evaluate(() => {
    const selected = document.querySelector<HTMLElement>('.question-options .option-item.selected')!;
    const read = (el: HTMLElement, label: string) => {
      const layers: string[] = [];
      for (let n: HTMLElement | null = el; n; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        layers.unshift(bg);
        const m = bg.match(/^rgba?\(([^)]+)\)$/);
        const alpha = m ? m[1].split(/[\s,/]+/).filter(Boolean).map(Number)[3] : undefined;
        if (m && (alpha === undefined || alpha === 1)) break;
      }
      const key = el.querySelector<HTMLElement>('.option-key')!;
      const mark = el.querySelector<HTMLElement>('.option-selected-mark');
      return {
        border: getComputedStyle(el).borderTopColor,
        layers,
        key: getComputedStyle(key).backgroundColor,
        keyText: getComputedStyle(key).color,
        text: getComputedStyle(el.querySelector<HTMLElement>('.option-text')!).color,
        hasMark: !!mark && getComputedStyle(mark).display !== 'none' && mark.getBoundingClientRect().width > 0,
        markFill: mark ? getComputedStyle(mark).backgroundColor : '',
        label: el.textContent ?? '',
      };
    };
    const out: Record<string, ReturnType<typeof read>> = { selected: read(selected, 'selected') };
    for (const status of ['correct', 'incorrect']) {
      const clone = selected.cloneNode(true) as HTMLElement;
      clone.querySelector('input')!.name = 'probe-' + status; // 同名的 radio 會取消原本那一個的勾選
      clone.querySelector('.option-selected-mark')?.remove();
      clone.className = `option-item ${status}`;
      selected.parentElement!.appendChild(clone);
      out[status] = read(clone, status);
      clone.remove();
    }
    return out;
  });
}

test('選取的選項：在每一種顯示設定與色覺下，框線、代號圓與底色都與正確、錯誤的樣式明顯不同（#148）', async ({
  page,
}) => {
  await startExamAndPickLast(page);

  let checked = 0;
  for (const theme of THEMES) {
    for (const cvd of CVD_MODES) {
      for (const hc of HC) {
        const mode = `${theme}/${cvd}/hc=${hc}`;
        const s = await readStates(page, theme, cvd, hc);
        const sel = s.selected;
        expect(sel.hasMark, `${mode} 選取的選項沒有圓點記號`).toBe(true);
        expect(sel.label, `${mode} 選取的選項帶了代表正確的圖示或字`).not.toMatch(/check_circle|verified|正確|答對/);

        const fill = (x: Styles): RGB => flatten(x.layers, `${mode} background`);
        const line = (x: Styles, what: 'border' | 'key'): RGB => flatten([...x.layers, x[what]], `${mode} ${what}`);
        for (const other of ['correct', 'incorrect'] as const) {
          for (const vision of VISIONS) {
            const at = `${mode} 以${vision}色覺看：選取 vs ${other}`;
            expect
              .soft(seenDifference(line(sel, 'border'), line(s[other], 'border'), vision), `${at} 的框線`)
              .toBeGreaterThanOrEqual(MIN_LINE_DELTA);
            expect
              .soft(seenDifference(line(sel, 'key'), line(s[other], 'key'), vision), `${at} 的代號圓`)
              .toBeGreaterThanOrEqual(MIN_LINE_DELTA);
            expect
              .soft(seenDifference(fill(sel), fill(s[other]), vision), `${at} 的底色`)
              .toBeGreaterThanOrEqual(MIN_FILL_DELTA);
            checked++;
          }
        }
        // 選取的樣式是無彩度的灰：底色、框線、代號圓的 CIELAB 彩度都要低於 3（ΔE 約 2.3 是剛好看得出的差異）。
        // 只比色差的話，換成淡淡的綠（例如深色主題 24% 的綠）也過得了，那就又和正確答案同一個顏色家族
        for (const [what, color] of [['底色', fill(sel)], ['框線', line(sel, 'border')], ['代號圓', line(sel, 'key')]] as const) {
          const [, a, b] = toLab(color);
          expect.soft(Math.hypot(a, b), `${mode} 選取的${what}要是中性的灰`).toBeLessThan(3);
        }
        // 選取的樣式本身也要看得清楚（WCAG：非文字 3:1、文字 4.5:1）
        const bg = fill(sel);
        // 圓點是實心的：中間的填色對選項底色也要 3:1，不能只是一個空心圈（空心圈看起來像沒選）
        expect
          .soft(contrast(flatten([...sel.layers, sel.markFill], `${mode} mark`), bg), `${mode} 圓點填色對底色`)
          .toBeGreaterThanOrEqual(3);
        expect.soft(contrast(line(sel, 'border'), bg), `${mode} 選取框線對底色`).toBeGreaterThanOrEqual(3);
        expect
          .soft(contrast(flatten([...sel.layers, sel.text], `${mode} text`), bg), `${mode} 選項文字對底色`)
          .toBeGreaterThanOrEqual(4.5);
        const keyFill = line(sel, 'key');
        expect
          .soft(contrast(flatten([...sel.layers, sel.key, sel.keyText], `${mode} key text`), keyFill), `${mode} 代號字對代號圓`)
          .toBeGreaterThanOrEqual(4.5);
      }
    }
  }
  expect(checked).toBe(16 * 2 * VISIONS.length);
});

// 滑鼠點了選項之後通常還停在上面：懸停的樣式不能把選取的樣式蓋回綠色
test('滑鼠停在選取的選項上，樣式與移開時相同（#148）', async ({ page }) => {
  await startExamAndPickLast(page);
  const selected = page.locator('.question-options .option-item.selected');
  await selected.hover();
  const style = () =>
    selected.evaluate((el) => {
      const cs = getComputedStyle(el);
      return [cs.borderTopColor, cs.backgroundColor, getComputedStyle(el.querySelector('.option-key')!).backgroundColor];
    });
  const hovered = await style();
  await page.mouse.move(0, 0);
  const away = await style();
  expect(hovered).toEqual(away);
});

// 強制色彩（Windows 高對比佈景主題）：瀏覽器把背景色換成 Canvas，用背景畫的圓點會變成空心圈，看起來就像沒選。
// 圓點在這個模式要改用 CanvasText 填滿
test('強制色彩模式下，選取的圓點仍是實心的（#148）', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await startExamAndPickLast(page);
  const forced = await page.evaluate(() => matchMedia('(forced-colors: active)').matches);
  test.skip(!forced, '這個引擎的 Playwright 不支援模擬強制色彩');
  const got = await page.locator('.question-options .option-item.selected').evaluate((el) => {
    const mark = el.querySelector<HTMLElement>('.option-selected-mark')!;
    const layers: string[] = [];
    for (let n: HTMLElement | null = el; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      layers.unshift(bg);
      if (/^rgb\(/.test(bg)) break;
    }
    return { fill: getComputedStyle(mark).backgroundColor, ring: getComputedStyle(mark).borderTopColor, layers };
  });
  const bg = flatten(got.layers, 'forced background');
  const fillColor = flatten([...got.layers, got.fill], 'forced mark fill');
  expect(contrast(fillColor, bg), `圓點填色 ${got.fill} 對底色`).toBeGreaterThanOrEqual(3);
  // 外圈也要看得到。WebKit 只讓媒體查詢成立、不真的換色，外圈仍是原本的灰，所以不要求兩者同色
  const ringColor = flatten([...got.layers, got.ring], 'forced mark ring');
  expect(contrast(ringColor, bg), `圓點外圈 ${got.ring} 對底色`).toBeGreaterThanOrEqual(3);
});
