import { test, expect } from '@playwright/test';

/**
 * #110/#112 回歸守門（rendered cascade）：被使用者「選中」的正解 / 選錯選項，其 .option-key 的
 * 背景必須是 --color-success-solid / --color-error-solid（白字安全實填）＋ on-color 文字，
 * 而**不是** :checked 選中態的 --color-primary。
 *
 * 為何非得 rendered：這是 selector 特異性的勝負問題 ——
 *   `.option-item input:checked + .option-key`（0,4,1，選中態=primary）
 *   會蓋過 `.option-item.correct .option-key`（0,3,0，success-solid）；
 * #110 靠再加 `.option-item.correct input:checked + .option-key`（0,5,1）才把正解/選錯搶回來。
 * token 值測試與 source-scan 都驗不到「某狀態下實際勝出的是哪條規則」；日後有人動特異性、
 * 只有這條 computed 斷言會轉紅。
 *
 * teeth：深色主題下 --color-primary(#81c784) ≠ success-solid(#2e7d32)，且 error-solid ≠ primary
 * （兩主題皆是）—— 移除 #110 的覆寫規則後，選中 key 會退回 primary，本測即失敗。
 * -solid 是不透明色，computed backgroundColor 可直接比對、無 tint alpha 合成的脆弱性。
 *
 * 用與 OptionButton 實際輸出同構的 replica（input 緊鄰 .option-key，相鄰選擇器 `+` 才成立），
 * 注入到「已載入 QuestionCard.css 的題目畫面」後讀 computed style —— 命中的是真實 CSS 規則。
 */

const REPLICA = `
  <div id="cascade-probe">
    <label class="option-item correct"><input type="radio" checked /><span class="option-key">A</span></label>
    <label class="option-item incorrect"><input type="radio" checked /><span class="option-key">B</span></label>
  </div>`;

function toRgb(s: string): number[] {
  const t = s.trim();
  const h6 = t.match(/^#([0-9a-fA-F]{6})$/);
  if (h6) return [0, 2, 4].map((i) => parseInt(h6[1].slice(i, i + 2), 16));
  const h3 = t.match(/^#([0-9a-fA-F]{3})$/);
  if (h3) return [0, 1, 2].map((i) => parseInt(h3[1][i] + h3[1][i], 16));
  const m = t.match(/-?\d+(?:\.\d+)?/g);
  if (!m || m.length < 3) throw new Error(`can't parse color: "${s}"`);
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}
function relLum([r, g, b]: number[]): number {
  const lin = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: number[], b: number[]): number {
  const la = relLum(a);
  const lb = relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const sameColor = (a: string, b: string): boolean =>
  JSON.stringify(toRgb(a)) === JSON.stringify(toRgb(b));

test('選中的正解/選錯 key 用 -solid 底 + on-color，勝過 :checked 選中態（#110 rendered，light+dark）', async ({
  page,
}) => {
  await page.addInitScript(() =>
    window.localStorage.setItem('practice-pool-disclosure-seen', '1')
  );
  await page.goto('/');
  // 進到題目畫面 → 確保 QuestionCard.css 已載入（precondition：真的有 .option-item 被渲染）
  await page.getByRole('button', { name: /開始測驗/i }).click();
  await expect(page.locator('.question-card')).toBeVisible();

  for (const theme of ['light', 'dark'] as const) {
    const probe = await page.evaluate(
      ({ html, theme }) => {
        const root = document.documentElement;
        const prevTheme = root.getAttribute('data-theme');
        root.setAttribute('data-theme', theme);
        const host = document.createElement('div');
        host.innerHTML = html;
        document.body.appendChild(host);
        const read = (sel: string) => {
          const el = host.querySelector(sel) as HTMLElement;
          const cs = getComputedStyle(el);
          return { bg: cs.backgroundColor, color: cs.color };
        };
        const out = {
          correct: read('.option-item.correct .option-key'),
          incorrect: read('.option-item.incorrect .option-key'),
          successSolid: getComputedStyle(root)
            .getPropertyValue('--color-success-solid')
            .trim(),
          errorSolid: getComputedStyle(root)
            .getPropertyValue('--color-error-solid')
            .trim(),
          onSuccess: getComputedStyle(root)
            .getPropertyValue('--color-on-success')
            .trim(),
          onError: getComputedStyle(root)
            .getPropertyValue('--color-on-error')
            .trim(),
        };
        host.remove();
        if (prevTheme === null) root.removeAttribute('data-theme');
        else root.setAttribute('data-theme', prevTheme);
        return out;
      },
      { html: REPLICA, theme }
    );

    // 正解 + 選中：底 = success-solid（非 primary 選中態），字 = on-success，對比達 AA
    expect(
      sameColor(probe.correct.bg, probe.successSolid),
      `${theme}: 正解選中 key 底應=success-solid，實得 bg=${probe.correct.bg} / solid=${probe.successSolid}`
    ).toBe(true);
    expect(
      sameColor(probe.correct.color, probe.onSuccess),
      `${theme}: 正解選中 key 字應=on-success，實得 ${probe.correct.color}`
    ).toBe(true);
    expect(
      contrast(toRgb(probe.correct.color), toRgb(probe.correct.bg)),
      `${theme}: 正解選中 key 對比`
    ).toBeGreaterThanOrEqual(4.5);

    // 選錯 + 選中：底 = error-solid，字 = on-error，對比達 AA
    expect(
      sameColor(probe.incorrect.bg, probe.errorSolid),
      `${theme}: 選錯選中 key 底應=error-solid，實得 bg=${probe.incorrect.bg} / solid=${probe.errorSolid}`
    ).toBe(true);
    expect(
      sameColor(probe.incorrect.color, probe.onError),
      `${theme}: 選錯選中 key 字應=on-error，實得 ${probe.incorrect.color}`
    ).toBe(true);
    expect(
      contrast(toRgb(probe.incorrect.color), toRgb(probe.incorrect.bg)),
      `${theme}: 選錯選中 key 對比`
    ).toBeGreaterThanOrEqual(4.5);
  }
});
