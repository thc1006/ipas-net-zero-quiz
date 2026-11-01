import { test, expect } from '@playwright/test';
import { flatten, type RGB } from './color-math';

/**
 * #148：結果頁的錯題卡寫「正確答案：D」，展開題庫相似題後，下一行就是另一題（q006）的題幹與選項，
 * 讀起來像是 q006 的答案是 D。相似題那一區要看得出是另外的題目：有標題、有看得見的框，
 * 錯題卡自己的答案在框外面、標題下面才是第一道相似題，每一題都標「相似題 N」。
 */
function relLum([r, g, b]: RGB): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

test('題庫相似題那一區與錯題卡的答案隔開，標題與每一題的標籤都看得到（#148）', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('practice-pool-disclosure-seen', '1');
  });
  await page.goto('/');
  await page.getByLabel(/題數/i).fill('10');
  await page.getByRole('button', { name: /開始測驗/i }).click();
  for (let i = 0; i < 10; i++) {
    await page.locator('.option-item').first().click();
    if (i < 9) await page.getByRole('button', { name: /下一題/i }).click();
  }
  await page.getByRole('button', { name: /完成測驗/i }).click();

  const card = page.locator('.wrong-item').first();
  await card.getByRole('button', { name: '題庫相似題' }).click();
  const panel = card.getByRole('region', { name: '題庫裡的其他相似題' });
  await expect(panel.getByRole('heading', { name: '題庫裡的其他相似題' })).toBeVisible();
  await expect(panel.getByText('下面是另外幾道題目，各有各的答案，與上面這一題的答案無關。')).toBeVisible();
  const items = panel.locator('.bank-similar-item');
  const n = await items.count();
  expect(n, '這一題沒有相似題：換一題或檢查 getSimilarQuestions').toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    await expect(items.nth(i).getByText(`相似題 ${i + 1}`, { exact: true })).toBeVisible();
  }

  // 位置：錯題卡的答案在框的上面，框的標題在第一道相似題的上面
  const answers = (await card.locator('.wrong-answers').boundingBox())!;
  const box = (await panel.boundingBox())!;
  const heading = (await panel.getByRole('heading').boundingBox())!;
  const firstStem = (await items.first().locator('.similar-stem').boundingBox())!;
  expect(answers.y + answers.height).toBeLessThanOrEqual(box.y);
  expect(heading.y + heading.height).toBeLessThanOrEqual(firstStem.y);

  // 框看得見：至少 2px，顏色對框外的底色達 WCAG 非文字的 3:1
  const style = await panel.evaluate((el) => {
    const layers: string[] = [];
    for (let n: HTMLElement | null = el.parentElement; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      layers.unshift(bg);
      if (/^rgb\(/.test(bg)) break;
    }
    const cs = getComputedStyle(el);
    return { width: parseFloat(cs.borderTopWidth), color: cs.borderTopColor, style: cs.borderTopStyle, layers };
  });
  expect(style.style).toBe('solid');
  expect(style.width).toBeGreaterThanOrEqual(2);
  const outside = flatten(style.layers, 'outside');
  const border = flatten([...style.layers, style.color], 'border');
  const [hi, lo] = [relLum(outside), relLum(border)].sort((a, b) => b - a);
  expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(3);
});
