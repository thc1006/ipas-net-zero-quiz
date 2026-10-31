// 題庫解析經過 renderMarkdown 才顯示。這個函式原本是給 AI 回覆用的，會把成對的星號當成斜體：
// gist-10 的 (25 * 3150) + (15 * 2360) 差點變成 (25 3150) + (15 2360)，少的是乘號，單元測試的合成字串看不到。
// 所以逐題比對：渲染後的文字要等於原文，只差掉 Markdown 的標記。
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../utils/render-markdown';
import datasetRaw from './integrated_dataset.json';
import poolRaw from './practice_pool.json';

interface Item {
  id?: string;
  item_id?: string;
  index?: number;
  explanation?: string | null;
}
const ds = datasetRaw as unknown as { gist_items: Item[]; our_unique_items: Item[] };
const ITEMS = [...ds.gist_items, ...ds.our_unique_items, ...(poolRaw as unknown as { items: Item[] }).items].filter(
  (i) => i.explanation
);

const renderedText = (markdown: string) => {
  const el = document.createElement('div');
  el.innerHTML = renderMarkdown(markdown);
  return el.textContent;
};
const withoutMarkup = (text: string) =>
  text
    .replace(/\*\*/gu, '')
    .replace(/`/gu, '')
    .replace(/^[-•]\s+/gmu, '• ');

describe('解析經過 Markdown 轉換不會改到內容', () => {
  it('每一題渲染後的文字都等於原文去掉標記', () => {
    const bad = ITEMS.filter((i) => renderedText(i.explanation!) !== withoutMarkup(i.explanation!)).map(
      (i) => i.id ?? i.item_id ?? `gist[${i.index}]`
    );
    expect(bad).toEqual([]);
  });

  it('真的掃到解析，也有用到粗體', () => {
    expect(ITEMS.length).toBeGreaterThan(900);
    expect(ITEMS.filter((i) => i.explanation!.includes('**')).length).toBeGreaterThan(50);
  });

  it('（變異測試）算式裡的乘號不會被當成斜體', () => {
    const formula = '(25 * 3150) + (15 * 2360)';
    expect(renderedText(formula)).toBe(formula);
    expect(renderMarkdown(formula)).not.toContain('<em>');
  });
});
