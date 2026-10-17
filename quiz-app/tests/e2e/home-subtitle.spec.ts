import { test, expect, devices, type Page, type Locator } from '@playwright/test';

/**
 * 首頁副標「iPAS 淨零碳規劃管理師（初級）考古題線上測驗」在窄螢幕、大字級與文字縮放下的排版。
 *
 * 副標拆成三個 inline-block 段，優先在段與段之間換行；各引擎開始換行的寬度不同，所以這支 spec 也跑在 Firefox 與 WebKit
 * （playwright.config.ts 的 firefox-smoke／webkit-smoke）。jsdom 不排版，只有真瀏覽器量得到。
 *
 * 看不看得見有兩道：measureSubtitle 從樣式量（透明度、對比、裁切……），inkProblems 直接拿截圖比對。
 * 樣式能讓字看不見的寫法太多（::first-line、疊色模式、pointer-events: none 的遮罩、不是祖先的底色、
 * 反向或旋轉），只從樣式量一定有漏的，截圖比對量的是畫面上真的畫出來的東西。
 */

// PR #37 加了首次自動彈 PracticeOptInDialog；先設定 seen flag，畫面才不會被 dialog 擋住
async function gotoHome(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('practice-pool-disclosure-seen', '1');
  });
  await page.goto('/');
}

// 等字型載完、有限長度的動畫與轉場都跑完才量：首頁進場有 250ms 的淡入，太早量會落在淡入途中。
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ready = async () => {
      await document.fonts.ready;
      const finite = document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity);
      await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
    };
    // 動畫被暫停、長得不合理或字型卡住時會一直等，每個測試都要到逾時，CI 整個 job 會被拖到 20 分鐘上限。
    // WebKit 改視窗大小後實測會卡 5 到 6 秒不出 frame，上限要遠大於這個
    await Promise.race([
      ready(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('字型或動畫 20 秒內沒有結束')), 20000);
      }),
    ]);
  });
}

const SUBTITLE = 'iPAS 淨零碳規劃管理師（初級）考古題線上測驗';
// 副標的三段；「（初級）」自成一段，文字縮放 200% 以內都不能被拆開
const UNITS = ['iPAS 淨零碳規劃管理師', '（初級）', '考古題線上測驗'];

/**
 * 把副標的字放大 zoom 倍，模擬瀏覽器「只放大文字」的縮放（腳本開不了真的文字縮放）。
 * 這個函式整段送進瀏覽器執行，不能引用外面的變數。
 */
function applyZoom(el: Element, zoom: number): void {
  const host = el as HTMLElement;
  host.style.fontSize = '';
  if (zoom !== 1) host.style.fontSize = `${parseFloat(getComputedStyle(host).fontSize) * zoom}px`;
}

/**
 * 量副標的真實排版。這個函式整段送進瀏覽器執行，不能引用外面的變數。
 * 回傳被拆到兩行的段、有一部分畫到畫面外的段、副標本身有沒有橫向溢出，以及「看不見或看起來不對」
 * 的問題。看得見與否是從每一段自己往上量到根，不是只看副標那一層：
 * - visibility；任何一層的 filter、clip-path、mask、直排；
 * - 實際畫字的顏色（-webkit-text-fill-color，沒設時等於 color）乘上逐層相乘的透明度，疊在背景上的對比，
 *   至少 4.5:1；
 * - 副標、三段、它們的祖先，以及畫面上和副標重疊的元素，都沒有無限重複的動畫：截圖只截到其中一格，
 *   字在動畫裡變淡、被蓋住或翻過來，要看截到哪一格；
 * - 任何一層都沒有刪除線、底線，文字方向是由左到右；
 * - 畫出來的寬度不能遠小於同字型的自然寬度（負的字距、被縮小）；
 * - 字的中心點最上層必須是這一段自己（沒有被別的東西蓋住；pointer-events: none 的遮罩 elementFromPoint
 *   看不到，由 inkProblems 的截圖擋）；
 * - 副標與三段的 ::before／::after 不能多畫字；
 * 另外是被 overflow 裁掉、行距重疊、閱讀順序，以及畫出來的字（innerText）就是原句。
 */
function measureSubtitle(el: Element, args: { units: string[]; text: string }) {
  const { units, text } = args;
  const host = el as HTMLElement;
  const fontSize = parseFloat(getComputedStyle(host).fontSize);
  if (!Number.isFinite(fontSize) || fontSize <= 0) throw new Error('讀不到副標字級');
  // 畫面寬度用 documentElement.clientWidth，不用整頁的 scrollWidth：首頁在很窄的寬度本來就能橫向捲動，
  // 那不是副標造成的
  const viewport = document.documentElement.clientWidth;
  const problems: string[] = [];
  const nameOf = (a: Element): string =>
    a.tagName.toLowerCase() + (a.classList.length ? `.${Array.from(a.classList).join('.')}` : '');
  const rgba = (c: string, what: string): number[] => {
    const m = c.match(/^rgba?\(([^)]+)\)$/);
    if (!m) throw new Error(`讀不懂${what}的顏色 ${c}`);
    const ch = m[1].split(/[\s,/]+/).filter(Boolean).map((x) => parseFloat(x));
    return [ch[0], ch[1], ch[2], ch.length >= 4 ? ch[3] : 1];
  };
  const over = (fg: number[], bg: number[]): number[] =>
    [0, 1, 2].map((i) => fg[3] * fg[i] + (1 - fg[3]) * bg[i]);
  const luminance = (c: number[]): number => {
    const [r, g, b] = c.map((v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) throw new Error('沒有 canvas 可以量字寬');

  // 無限重複的動畫（有限的動畫 settle 已經等它跑完）。::before／::after 的動畫，target 是它所屬的元素
  const hostBox = host.getBoundingClientRect();
  for (const anim of document.getAnimations()) {
    const effect = anim.effect as KeyframeEffect | null;
    if (!effect || effect.getComputedTiming().endTime !== Infinity || !effect.target) continue;
    const target = effect.target;
    const box = target.getBoundingClientRect();
    const overlaps =
      box.left < hostBox.right && box.right > hostBox.left && box.top < hostBox.bottom && box.bottom > hostBox.top;
    if (target === host || host.contains(target) || target.contains(host) || overlaps) {
      const name = (anim as CSSAnimation).animationName ?? '';
      problems.push(`${nameOf(target)}${effect.pseudoElement ?? ''} 有無限重複的動畫 ${name}`.trimEnd());
    }
  }

  // innerText 會套用 text-transform 的大小寫轉換（full-width 這類改寫不會反映在 innerText，由截圖比對擋）：
  // 畫出來的字必須就是原句
  if (host.innerText !== text) problems.push(`畫出來的字是「${host.innerText}」`);

  const texts: Text[] = [];
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);

  const split: string[] = [];
  const offscreen: string[] = [];
  const placed: { unit: string; rects: DOMRect[] }[] = [];
  const painted: Element[] = [host];
  for (const unit of units) {
    // 每一段都自成一個文字節點：「（初級）」不拆開靠的是它自成一段，和別的字擠在同一段就沒有這個保證
    const node = texts.find((t) => t.data === unit);
    if (!node) throw new Error(`副標裡沒有自成一段的「${unit}」`);
    const span = node.parentElement!;
    painted.push(span);
    const own = getComputedStyle(span);

    // 從這一段往上每一層：透明度相乘；filter、clip-path、mask、直排任何一層有，這一段就看不見或變形
    let opacity = 1;
    for (let a: Element | null = span; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      opacity *= parseFloat(cs.opacity);
      if (cs.filter !== 'none') problems.push(`「${unit}」所在的 ${nameOf(a)} 有 filter: ${cs.filter}`);
      if (cs.clipPath !== 'none') problems.push(`「${unit}」所在的 ${nameOf(a)} 有 clip-path: ${cs.clipPath}`);
      for (const mask of [cs.maskImage, cs.webkitMaskImage]) {
        if (mask && mask !== 'none') problems.push(`「${unit}」所在的 ${nameOf(a)} 有 mask: ${mask}`);
      }
      if (cs.writingMode !== 'horizontal-tb') {
        problems.push(`「${unit}」所在的 ${nameOf(a)} 不是橫排（${cs.writingMode}）`);
      }
      // 刪除線、底線會改變字的意思；反向的文字方向會把字倒過來排（截圖比對也擋，這裡再擋一道）
      if (cs.textDecorationLine !== 'none') {
        problems.push(`「${unit}」所在的 ${nameOf(a)} 有 text-decoration: ${cs.textDecorationLine}`);
      }
      if (cs.direction !== 'ltr' || !['normal', 'isolate'].includes(cs.unicodeBidi)) {
        problems.push(`「${unit}」所在的 ${nameOf(a)} 的文字方向是 ${cs.direction}（unicode-bidi: ${cs.unicodeBidi}）`);
      }
    }
    if (own.visibility !== 'visible') problems.push(`「${unit}」的 visibility 是 ${own.visibility}`);

    // 對比：實際畫字的顏色疊在背後的背景上。背景往上找到第一層不透明的為止，途中半透明的一層層疊上去；
    // 碰到背景圖（漸層）就量不準，直接算問題，不放行
    const fill = rgba(own.webkitTextFillColor || own.color, `「${unit}」的文字`);
    // 透明度要乘進字色：opacity 0.5 的黑字在白底上只有 4.0:1，字色本身的對比卻是 21:1
    fill[3] *= opacity;
    const layers: number[][] = [];
    let measurable = true;
    for (let a: Element | null = span; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.backgroundImage !== 'none') {
        problems.push(`「${unit}」背後的 ${nameOf(a)} 有背景圖，量不了對比`);
        measurable = false;
        break;
      }
      const bg = rgba(cs.backgroundColor, `${nameOf(a)} 的背景`);
      if (bg[3] > 0) layers.push(bg);
      if (bg[3] >= 1) break;
    }
    if (measurable) {
      // 最底下是瀏覽器的畫布，淺色主題是白色
      let backdrop = [255, 255, 255];
      for (const layer of [...layers].reverse()) backdrop = over(layer, backdrop);
      const [hi, lo] = [luminance(over(fill, backdrop)), luminance(backdrop)].sort((x, y) => y - x);
      const ratio = (hi + 0.05) / (lo + 0.05);
      // 副標的字級 16 到 24px、一般字重，大多不算 WCAG 的大字，所以門檻是 4.5:1
      if (!(ratio >= 4.5)) {
        problems.push(`「${unit}」的字和背景對比只有 ${ratio.toFixed(2)}:1（含透明度 ${opacity}）`);
      }
    }

    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, unit.length);
    // 面積是 0 的框（font-size: 0 之類）不算畫出來
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    // 沒有版面框（display:none 之類）不能當成「沒有斷開」放行
    if (rects.length === 0) throw new Error(`「${unit}」沒有畫在畫面上`);

    // 字寬：canvas 用同一個字型量自然寬度。字距被壓扁（負的 letter-spacing）、整段被縮小（transform），
    // 畫出來的寬度都會遠小於自然寬度
    ctx.font = `${own.fontStyle} ${own.fontWeight} ${own.fontSize} ${own.fontFamily}`;
    const natural = ctx.measureText(unit).width;
    const drawn = rects.reduce((sum, r) => sum + r.width, 0);
    if (!(drawn >= natural * 0.8)) {
      problems.push(`「${unit}」畫出來 ${Math.round(drawn)}px 寬，同字型的自然寬度是 ${Math.round(natural)}px`);
    }

    // 沒有被蓋住：每一塊字的中心點，最上層的元素必須是這一段自己
    let hits = 0;
    for (const r of rects) {
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
      hits++;
      const top = document.elementFromPoint(x, y);
      if (!top || !(top === span || span.contains(top))) {
        problems.push(`「${unit}」被 ${top ? nameOf(top) : '（沒有元素）'} 蓋住`);
      }
    }
    if (hits === 0) problems.push(`「${unit}」不在視窗內，無法確認有沒有被蓋住`);

    const tops = rects.map((r) => r.top);
    // 換行會讓下一行往下移至少一個字高；同一行裡不同字型的上緣差距遠小於半個字高
    if (Math.max(...tops) - Math.min(...tops) > fontSize / 2) split.push(unit);
    if (rects.some((r) => r.left < -0.5 || r.right > viewport + 0.5)) offscreen.push(unit);
    // 被任何一層 overflow 不是 visible 的祖先裁掉，也是看不見
    for (let a: Element | null = span; a; a = a.parentElement) {
      const acs = getComputedStyle(a);
      if (acs.overflowX === 'visible' && acs.overflowY === 'visible') continue;
      const box = a.getBoundingClientRect();
      const clipped = rects.some(
        (r) =>
          r.left < box.left - 0.5 ||
          r.right > box.right + 0.5 ||
          r.top < box.top - 0.5 ||
          r.bottom > box.bottom + 0.5
      );
      if (clipped) problems.push(`「${unit}」被 ${nameOf(a)} 裁掉`);
    }
    placed.push({ unit, rects });
  }

  // 副標與三段的 ::before／::after 不能多畫字（例如在後面再接一個等級）；空字串的裝飾不算
  for (const s of painted) {
    for (const pseudo of ['::before', '::after']) {
      const content = getComputedStyle(s, pseudo).content;
      if (content !== 'none' && content !== 'normal' && content !== '""') {
        problems.push(`${nameOf(s)}${pseudo} 多畫了 ${content}`);
      }
    }
  }

  // 行距：不同行的上緣至少差 0.8 個字高，否則字會疊在一起
  const lineTops = placed
    .flatMap((p) => p.rects.map((r) => r.top))
    .sort((a, b) => a - b)
    .filter((t, i, all) => i === 0 || t - all[i - 1] > fontSize / 2);
  for (let i = 1; i < lineTops.length; i++) {
    if (lineTops[i] - lineTops[i - 1] < fontSize * 0.8) problems.push('兩行疊在一起');
  }
  // 閱讀順序：每一段都接在前一段後面（同一行在右邊，或在下面的行）
  for (let i = 1; i < placed.length; i++) {
    const prev = placed[i - 1].rects;
    const prevLast = prev.reduce((a, b) => (b.top > a.top + fontSize / 2 || b.right > a.right ? b : a));
    const first = placed[i].rects.reduce((a, b) => (b.top < a.top - fontSize / 2 || b.left < a.left ? b : a));
    const laterLine = first.top > prevLast.top + fontSize / 2;
    const sameLineAfter = Math.abs(first.top - prevLast.top) <= fontSize / 2 && first.left >= prevLast.right - 1;
    if (!laterLine && !sameLineAfter) problems.push(`「${placed[i].unit}」排在「${placed[i - 1].unit}」前面`);
  }
  return { split, offscreen, overflow: host.scrollWidth > host.clientWidth, problems };
}

// 參考畫面跟著副標一起量的版面相關樣式（都會繼承：副標的三段照樣繼承它們）
const INHERITED = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-kerning', 'font-feature-settings',
  'font-variant-east-asian', 'font-optical-sizing', 'line-height', 'letter-spacing', 'word-spacing', 'text-align',
  'text-indent', 'white-space', 'word-break', 'line-break', 'overflow-wrap', 'hyphens', 'text-spacing-trim',
  'text-autospace', 'text-rendering', '-webkit-font-smoothing',
];
// 截圖比對的門檻（三個引擎共 267 種寬度、字級、縮放下實測：沒動過的副標，覆蓋率最低 0.98、對比高於 5:1；
// 門檻要低於這兩個值，又要擋得下讓字看不見的寫法）
const COVERAGE = 0.93;
const CONTRAST = 4.5;

/**
 * 在副標正上方疊一份參考畫面：同樣的字、同樣的寬度與版面樣式（INHERITED、padding、border），字色是副標的
 * 字色（拿掉半透明）、底色是副標背後第一層不透明的底色，但沒有副標與三段自己的 opacity、疊色、變形、裝飾、
 * 文字方向，三段也不帶任何樣式。顏色跟著主題走：深底淺字的反鋸齒筆畫比淺底深字細，參考畫面一律黑字白底時，
 * 深色主題的覆蓋率會偏低。回傳參考畫面裡每一段的字框。
 * 這個函式整段送進瀏覽器執行，不能引用外面的變數。
 */
function placeReference(el: Element, args: { units: string[]; inherited: string[] }) {
  const host = el as HTMLElement;
  const cs = getComputedStyle(host);
  const box = host.getBoundingClientRect();
  const ref = document.createElement('div');
  ref.id = 'subtitle-reference';
  ref.setAttribute('style', 'all: initial');
  const own = [
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width',
    'border-bottom-width', 'border-left-width', 'border-top-style', 'border-right-style', 'border-bottom-style',
    'border-left-style',
  ];
  for (const p of [...args.inherited, ...own]) ref.style.setProperty(p, cs.getPropertyValue(p));
  const opaque = (c: string): string | null => {
    const m = c.match(/^rgba?\(([^)]+)\)$/);
    if (!m) return null;
    const ch = m[1].split(/[\s,/]+/).filter(Boolean).map((v) => parseFloat(v));
    return ch.length >= 4 && ch[3] === 0 ? null : `rgb(${ch[0]}, ${ch[1]}, ${ch[2]})`;
  };
  let backdrop = 'rgb(255, 255, 255)';
  for (let a: Element | null = host; a; a = a.parentElement) {
    const bg = getComputedStyle(a).backgroundColor;
    const m = bg.match(/^rgba?\(([^)]+)\)$/);
    const alpha = m ? m[1].split(/[\s,/]+/).filter(Boolean).map((v) => parseFloat(v))[3] ?? 1 : 0;
    if (alpha >= 1) {
      backdrop = bg;
      break;
    }
  }
  const fixed: Record<string, string> = {
    'border-color': 'transparent', display: 'block', 'box-sizing': 'border-box', position: 'fixed',
    'z-index': '2147483647', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`,
    height: `${box.height}px`, margin: '0', background: backdrop,
    color: opaque(cs.webkitTextFillColor || cs.color) ?? 'rgb(0, 0, 0)',
  };
  for (const [p, v] of Object.entries(fixed)) ref.style.setProperty(p, v);
  for (const unit of args.units) {
    const span = document.createElement('span');
    span.setAttribute('style', 'all: initial');
    for (const p of args.inherited) span.style.setProperty(p, 'inherit');
    span.style.setProperty('display', 'inline-block');
    span.style.setProperty('color', 'inherit');
    span.textContent = unit;
    ref.appendChild(span);
  }
  document.body.appendChild(ref);
  return Array.from(ref.children).map((span) => {
    const range = document.createRange();
    range.selectNodeContents(span.firstChild!);
    return Array.from(range.getClientRects())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }));
  });
}

/**
 * 兩張截圖（副標本身、參考畫面）逐段比：每一段的字框裡，底色是出現最多次的顏色（兩張各自算），和底色的
 * 對比至少 1.5:1 的像素算字跡。回傳每一段：實際畫面最深的字和底色的對比、參考的字跡有多少被實際的字跡蓋到（各往外擴一個
 * CSS px，容許反鋸齒與次像素的差）、實際的字跡有多少落在參考的字跡上。
 * 這個函式整段送進瀏覽器執行（用 canvas 解 PNG），不能引用外面的變數。
 */
async function analyzeInk(args: {
  actual: string;
  reference: string;
  clip: { x: number; y: number };
  dpr: number;
  regions: { left: number; top: number; right: number; bottom: number }[][];
}) {
  const load = async (b64: string) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('沒有 canvas 可以讀截圖');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, c.width, c.height);
  };
  const a = await load(args.actual);
  const r = await load(args.reference);
  if (a.width !== r.width || a.height !== r.height) throw new Error('兩張截圖大小不同');
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum = (d: Uint8ClampedArray, i: number) =>
    0.2126 * channel(d[i]) + 0.7152 * channel(d[i + 1]) + 0.0722 * channel(d[i + 2]);
  const contrast = (x: number, y: number) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  const W = a.width;
  const R = Math.max(1, Math.round(args.dpr));
  return args.regions.map((rects) => {
    let inkActual = 0;
    let inkReference = 0;
    let referenceCovered = 0;
    let actualCovered = 0;
    let best = 1;
    for (const rect of rects) {
      const x0 = Math.max(0, Math.floor((rect.left - args.clip.x) * args.dpr) - R);
      const y0 = Math.max(0, Math.floor((rect.top - args.clip.y) * args.dpr) - R);
      const x1 = Math.min(W, Math.ceil((rect.right - args.clip.x) * args.dpr) + R);
      const y1 = Math.min(a.height, Math.ceil((rect.bottom - args.clip.y) * args.dpr) + R);
      const ww = x1 - x0;
      const hh = y1 - y0;
      if (ww <= 0 || hh <= 0) continue;
      const modeLum = (img: ImageData) => {
        const seen = new Map<number, number>();
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * W + x) * 4;
            const key = (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
            seen.set(key, (seen.get(key) ?? 0) + 1);
          }
        }
        let bg = 0;
        let most = -1;
        for (const [key, n] of seen) if (n > most) [bg, most] = [key, n];
        return lum(new Uint8ClampedArray([(bg >> 16) & 255, (bg >> 8) & 255, bg & 255]), 0);
      };
      const bgLum = modeLum(a);
      const refLum = modeLum(r);
      const am = new Uint8Array(ww * hh);
      const rm = new Uint8Array(ww * hh);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 4;
          const c = contrast(lum(a.data, i), bgLum);
          if (c > best) best = c;
          if (c >= 1.5) am[(y - y0) * ww + (x - x0)] = 1;
          if (contrast(lum(r.data, i), refLum) >= 1.5) rm[(y - y0) * ww + (x - x0)] = 1;
        }
      }
      const grow = (m: Uint8Array) => {
        const out = new Uint8Array(m.length);
        for (let y = 0; y < hh; y++) {
          for (let x = 0; x < ww; x++) {
            if (!m[y * ww + x]) continue;
            for (let dy = Math.max(0, y - R); dy <= Math.min(hh - 1, y + R); dy++) {
              for (let dx = Math.max(0, x - R); dx <= Math.min(ww - 1, x + R); dx++) out[dy * ww + dx] = 1;
            }
          }
        }
        return out;
      };
      const ag = grow(am);
      const rg = grow(rm);
      for (let i = 0; i < am.length; i++) {
        inkActual += am[i];
        inkReference += rm[i];
        if (rm[i] && ag[i]) referenceCovered++;
        if (am[i] && rg[i]) actualCovered++;
      }
    }
    return {
      inkReference,
      contrast: best,
      coverReference: inkReference ? referenceCovered / inkReference : 0,
      coverActual: inkActual ? actualCovered / inkActual : 0,
    };
  });
}

/** 截圖比對副標：每一段都要畫得出來、看得清楚，字形就是參考畫面的樣子（沒有變形、反向、多畫或少畫） */
async function inkProblems(page: Page, subtitle: Locator): Promise<string[]> {
  const box = await subtitle.boundingBox();
  if (!box) return ['副標沒有畫在畫面上'];
  const viewport = page.viewportSize()!;
  const x = Math.max(0, Math.floor(box.x) - 2);
  const y = Math.max(0, Math.floor(box.y) - 2);
  const clip = {
    x,
    y,
    width: Math.min(viewport.width, Math.ceil(box.x + box.width) + 2) - x,
    height: Math.min(viewport.height, Math.ceil(box.y + box.height) + 2) - y,
  };
  // 實際畫面照使用者看到的截：不關動畫（'disabled' 會把無限動畫取消回到初始狀態，截到的不是畫面上的樣子）。
  // 有限的動畫 settle 已經等它跑完
  const actual = await page.screenshot({ clip, animations: 'allow', caret: 'hide' });
  const regions = await subtitle.evaluate(placeReference, { units: UNITS, inherited: INHERITED });
  let reference: Buffer;
  try {
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    reference = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  } finally {
    await page.evaluate(() => document.getElementById('subtitle-reference')?.remove());
  }
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const stats = await page.evaluate(analyzeInk, {
    actual: actual.toString('base64'),
    reference: reference.toString('base64'),
    clip: { x: clip.x, y: clip.y },
    dpr,
    regions,
  });
  const percent = (v: number) => `${Math.round(v * 100)}%`;
  return stats.flatMap((s, i) => {
    const unit = UNITS[i];
    if (s.inkReference === 0) return [`「${unit}」的參考畫面沒有字跡，比對不了`];
    const out: string[] = [];
    if (s.contrast < CONTRAST) out.push(`「${unit}」畫出來的字和底色對比只有 ${s.contrast.toFixed(2)}:1`);
    if (s.coverReference < COVERAGE) {
      out.push(`「${unit}」只畫出參考字跡的 ${percent(s.coverReference)}（看不見、被蓋住、變形或排錯）`);
    }
    if (s.coverActual < COVERAGE) {
      out.push(`「${unit}」有 ${percent(1 - s.coverActual)} 的字跡不在參考畫面上（刪除線、底色、變形或排錯）`);
    }
    return out;
  });
}

type Theme = { name: string; theme: 'light' | 'dark'; highContrast: boolean };
const THEMES: Theme[] = [
  { name: '淺色', theme: 'light', highContrast: false },
  { name: '深色', theme: 'dark', highContrast: false },
  { name: '高對比', theme: 'light', highContrast: true },
  { name: '深色高對比', theme: 'dark', highContrast: true },
];

type At = { width: number; height?: number; size: string; zoom: number; theme?: Theme };

async function setUp(page: Page, subtitle: Locator, at: At) {
  await page.setViewportSize({ width: at.width, height: at.height ?? 900 });
  const theme = at.theme ?? THEMES[0];
  await page.evaluate(
    ([size, name, high]) => {
      const root = document.documentElement;
      root.setAttribute('data-font-size', size);
      root.setAttribute('data-theme', name);
      root.setAttribute('data-high-contrast', high);
    },
    [at.size, theme.theme, String(theme.highContrast)]
  );
  await subtitle.evaluate(applyZoom, at.zoom);
  await settle(page);
}

// 寬度含 iPhone SE 一代（320）、Galaxy Fold 外螢幕（344）、主流手機（360 到 430，含 393、412、414 這些常見的
// 寬度：391 到 420 之間以前沒有量，在那裡放寬的樣式照樣全綠）、頁面縮放後的窄寬度（375pt 的 iPhone 開 125%
// 是 300 CSS px），以及 430 以上：只在寬螢幕生效的樣式（平板、桌面、768／769 斷點兩側）不量就沒有人守。
// 桌機最常見的 1280、1440、1920 也要量：以前最寬只到 1024，只在 1025px 以上生效的樣式照樣全綠
const WIDTHS = [
  240, 268, 280, 296, 300, 320, 344, 360, 375, 390, 393, 400, 412, 414, 420, 430, 436, 455, 540, 768, 769, 1024,
  1280, 1440, 1920,
];
// 橫放的手機：高度只有 375 到 390px，只在矮螢幕生效的樣式（max-height）直放量不到
const LANDSCAPE = [
  { width: 844, height: 390 },
  { width: 667, height: 375 },
];
const VIEWPORTS = [...WIDTHS.map((width) => ({ width, height: 900 })), ...LANDSCAPE];

test.describe('首頁副標', () => {
  test('就是這一句，看得見，螢幕閱讀器也念得到', async ({ page }) => {
    await gotoHome(page);
    const subtitle = page.locator('.hero-subtitle');
    await expect(subtitle).toBeVisible();
    await expect(subtitle).toHaveText(SUBTITLE);
    // 無障礙樹：三段之間會多出空白，比對時拿掉；任何一段被 aria-hidden 藏起來就會少字
    const spoken = (await subtitle.ariaSnapshot()).replace(/^- paragraph:/, '').replace(/\s+/g, '');
    expect(spoken).toBe(SUBTITLE.replace(/\s+/g, ''));
  });

  // 寬度含 iPhone SE 一代（320）、Galaxy Fold 外螢幕（344）、主流手機（360 到 430）、頁面縮放後的窄寬度
  // （375pt 的 iPhone 開 125% 是 300 CSS px），以及 430 以上：只在寬螢幕生效的樣式（平板、桌面、
  // 768／769 斷點兩側）不量就沒有人守。字級是 app 的三段設定；文字縮放到 200%。
  // 每一種組合：「（初級）」不能拆開、不能畫到畫面外、要看得見。不縮放而且寬度在 280px 以上時，
  // 三段都要各自落在同一行。
  test('各種寬度、字級、文字縮放：「（初級）」不拆開，不超出畫面，看得見', async ({ page }) => {
    test.setTimeout(180_000);
    await gotoHome(page);
    const subtitle = page.locator('.hero-subtitle');
    await expect(subtitle).toBeVisible();
    await settle(page);
    const failures: string[] = [];
    let measured = 0;
    for (const { width, height } of VIEWPORTS) {
      await page.setViewportSize({ width, height });
      for (const size of ['normal', 'large', 'xlarge']) {
        await page.evaluate((s) => document.documentElement.setAttribute('data-font-size', s), size);
        for (const zoom of [1, 1.25, 1.5, 2]) {
          await subtitle.evaluate(applyZoom, zoom);
          await settle(page);
          const r = await subtitle.evaluate(measureSubtitle, { units: UNITS, text: SUBTITLE });
          measured++;
          const at = `${width}x${height} ${size} 文字 ${zoom * 100}%`;
          if (r.split.includes('（初級）')) failures.push(`${at}：「（初級）」被拆開`);
          if (zoom === 1 && width >= 280) {
            for (const u of r.split.filter((u) => u !== '（初級）')) failures.push(`${at}：「${u}」被拆開`);
          }
          if (r.offscreen.length > 0) failures.push(`${at}：${r.offscreen.join('、')} 畫到畫面外`);
          if (r.overflow) failures.push(`${at}：副標橫向溢出`);
          for (const p of r.problems) failures.push(`${at}：${p}`);
        }
      }
    }
    expect(measured).toBe(VIEWPORTS.length * 3 * 4);
    expect(failures).toEqual([]);
  });

  // 截圖比對：每一種寬度與橫放手機在一般字級、不縮放時量一次；幾種寬度再加上大字級與縮放；四種主題各量幾種寬度
  test('截圖比對：每一段都畫得出來、看得清楚，字形就是原句', async ({ page }) => {
    test.setTimeout(300_000);
    await gotoHome(page);
    const subtitle = page.locator('.hero-subtitle');
    await expect(subtitle).toBeVisible();
    await settle(page);
    const combos: At[] = [
      ...WIDTHS.map((width) => ({ width, size: 'normal', zoom: 1 })),
      ...LANDSCAPE.flatMap((v) => ['normal', 'xlarge'].map((size) => ({ ...v, size, zoom: 1 }))),
      ...[240, 320, 390, 412, 768, 1024].flatMap((width) =>
        ['normal', 'large', 'xlarge'].flatMap((size) =>
          [1.5, 2].map((zoom) => ({ width, size, zoom }))
        )
      ),
      ...THEMES.slice(1).flatMap((theme) =>
        [320, 412, 1024, 1280].flatMap((width) =>
          ['normal', 'xlarge'].map((size) => ({ width, size, zoom: 1, theme }))
        )
      ),
    ];
    const failures: string[] = [];
    for (const at of combos) {
      await setUp(page, subtitle, at);
      const where = `${at.width}x${at.height ?? 900} ${at.size} 文字 ${at.zoom * 100}% ${(at.theme ?? THEMES[0]).name}`;
      for (const p of await inkProblems(page, subtitle)) failures.push(`${where}：${p}`);
    }
    expect(combos.length).toBe(WIDTHS.length + 4 + 36 + 24);
    expect(failures).toEqual([]);
  });

  // 只在觸控裝置生效的樣式（@media (pointer: coarse)、(hover: none)）桌面的裝置描述量不到。Firefox 不支援
  // isMobile，在 Chromium 與 WebKit 各用一支手機的描述量版面與截圖
  test('手機（觸控、isMobile）：版面與截圖比對', async ({ browser, browserName }, testInfo) => {
    test.skip(browserName === 'firefox', 'Firefox 不支援 isMobile');
    test.setTimeout(180_000);
    const device = browserName === 'webkit' ? devices['iPhone 14'] : devices['Pixel 7'];
    const context = await browser.newContext({ ...device, baseURL: testInfo.project.use.baseURL });
    try {
      const page = await context.newPage();
      await gotoHome(page);
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      const subtitle = page.locator('.hero-subtitle');
      await expect(subtitle).toBeVisible();
      await settle(page);
      const failures: string[] = [];
      for (const width of [320, 360, 390, 412, 430]) {
        for (const size of ['normal', 'xlarge']) {
          for (const zoom of [1, 2]) {
            await setUp(page, subtitle, { width, size, zoom });
            const where = `${width}px ${size} 文字 ${zoom * 100}%`;
            const r = await subtitle.evaluate(measureSubtitle, { units: UNITS, text: SUBTITLE });
            if (r.split.includes('（初級）')) failures.push(`${where}：「（初級）」被拆開`);
            if (r.offscreen.length > 0) failures.push(`${where}：${r.offscreen.join('、')} 畫到畫面外`);
            if (r.overflow) failures.push(`${where}：副標橫向溢出`);
            for (const p of [...r.problems, ...(await inkProblems(page, subtitle))]) failures.push(`${where}：${p}`);
          }
        }
      }
      expect(failures).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
