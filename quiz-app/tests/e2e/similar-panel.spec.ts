import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

// 主題庫的題目與答案：考一題、故意選錯，結果頁就一定有一張錯題卡（不靠多答幾題碰運氣）
const BANK = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../src/data/integrated_dataset.json', import.meta.url)), 'utf8')
) as { gist_items: BankItem[]; our_unique_items: BankItem[] };
interface BankItem {
  stem: string;
  options: { key: string; text: string }[];
  answer: string | null;
}

async function finishWithWrongAnswers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('practice-pool-disclosure-seen', '1');
  });
  await page.goto('/');
  await page.getByLabel(/測驗模式/i).selectOption('exam');
  await page.getByLabel(/題數/i).fill('1');
  await page.getByRole('button', { name: /開始測驗/i }).click();
  const stem = (await page.locator('.question-stem p').textContent())!;
  const texts = await page.locator('.question-options .option-text').allTextContents();
  const item = [...BANK.gist_items, ...BANK.our_unique_items].find(
    (q) => q.stem === stem && q.options.every((o, i) => o.text === texts[i])
  );
  expect(item?.answer, `題庫裡找不到抽到的這一題或它沒有答案：${stem}`).toBeTruthy();
  const wrong = item!.options.find((o) => o.key !== item!.answer)!.key;
  await page.getByTestId(`option-${wrong}`).click();
  await page.getByRole('button', { name: /完成測驗/i }).click();
}

test('題庫相似題那一區與錯題卡的答案隔開，標題與每一題的標籤都看得到（#148）', async ({ page }) => {
  await finishWithWrongAnswers(page);
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

/**
 * AI 生成相似題（#148）：換掉 Puter，讓「模型」照抄 prompt 裡的原題題幹（或回一道新題）。
 * prompt 是真的組出來的那一份，所以這裡也驗到 prompt 帶了「原題目：」那一行。
 */
async function stubPuter(page: Page, mode: 'echo' | 'new'): Promise<void> {
  await page.addInitScript((m) => {
    const w = window as unknown as Record<string, unknown>;
    w.puter = {
      ai: {
        chat: async (prompt: string) => {
          const stem = /原題目：(.*)/.exec(prompt)?.[1] ?? '';
          return m === 'echo'
            ? `題目：${stem}\nA. 甲\nB. 乙\nC. 丙\nD. 丁\n正確答案：C`
            : '題目：某工廠的鍋爐燃燒天然氣，屬於哪一類排放？\nA. 類別 1\nB. 類別 2\nC. 類別 3\nD. 類別 4\n正確答案：A';
        },
      },
      auth: { isSignedIn: () => true, signIn: async () => ({}), getUser: async () => ({ username: 'e2e' }) },
      print: () => {},
    };
  }, mode);
}

const NOTE = '這是 AI 依同一個概念另外寫的題目，它附的答案只適用於這道 AI 題目。';
const ECHO_NOTE =
  '這道 AI 題目和上面這一題很像。上面這一題的答案以這張卡上的「正確答案」為準，AI 附的答案可能是錯的。';

test('AI 生成相似題：標明是 AI 另外寫的題目，內容照常顯示（#148）', async ({ page }) => {
  await stubPuter(page, 'new');
  await finishWithWrongAnswers(page);
  const card = page.locator('.wrong-item').first();
  await card.getByRole('button', { name: 'AI 生成相似題' }).click();
  await expect(card.getByText('AI 生成的新題目（不是上面這一題）')).toBeVisible();
  await expect(card.getByText(NOTE)).toBeVisible();
  await expect(card.getByText(/某工廠的鍋爐燃燒天然氣/)).toBeVisible();
  await expect(card.getByText(ECHO_NOTE)).toHaveCount(0);
});

test('AI 生成相似題：題幹照抄原題時，內容照樣顯示，多一句提醒（#148）', async ({ page }) => {
  await stubPuter(page, 'echo');
  await finishWithWrongAnswers(page);
  const card = page.locator('.wrong-item').first();
  await card.getByRole('button', { name: 'AI 生成相似題' }).click();
  await expect(card.getByText(ECHO_NOTE)).toBeVisible();
  await expect(card.locator('.generated-content').getByText('正確答案：C')).toBeVisible();
  await expect(card.getByRole('alert')).toHaveCount(0);
});
