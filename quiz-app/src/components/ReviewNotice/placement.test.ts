// 提示選邊：不論視窗多矮、提示多高、anchor 在哪裡，放好的提示都不和 anchor 重疊。真的排版在 star-review.spec.ts 驗。
import { describe, expect, it } from 'vitest';
import { placeNotice, type NoticeLayout } from './placement';

const base: Omit<NoticeLayout, 'anchor'> = { viewportHeight: 839, headerBottom: 57, gap: 8, noticeHeight: 61 };

/** 放好之後提示在視窗裡佔的範圍 */
function noticeRect(layout: NoticeLayout) {
  const { side, maxHeight } = placeNotice(layout);
  const height = Math.min(layout.noticeHeight, maxHeight ?? Infinity);
  const top = side === 'top' ? layout.headerBottom + layout.gap : layout.viewportHeight - layout.gap - height;
  return { side, top, bottom: top + height, height, capped: maxHeight !== null };
}

describe('placeNotice', () => {
  it('沒有 anchor、anchor 在頁首裡或視窗外：放底部，不限高度', () => {
    for (const anchor of [null, { top: 10, bottom: 50 }, { top: 900, bottom: 944 }, { top: -80, bottom: -36 }]) {
      expect(placeNotice({ ...base, anchor })).toEqual({ side: 'bottom', maxHeight: null });
    }
  });

  it('題目頁的星號在上方：放底部（與原本一樣）', () => {
    expect(placeNotice({ ...base, anchor: { top: 120, bottom: 164 } })).toEqual({ side: 'bottom', maxHeight: null });
  });

  it('結果頁的星號在視窗底部上方 20px（Pixel 7）：放頁首下面', () => {
    expect(placeNotice({ ...base, anchor: { top: 775, bottom: 819 } })).toEqual({ side: 'top', maxHeight: null });
  });

  it('320x256 字級特大，題卡的星號在下半：放頁首下面', () => {
    const tiny = { viewportHeight: 256, headerBottom: 66, gap: 8, noticeHeight: 74 };
    expect(placeNotice({ ...tiny, anchor: { top: 192, bottom: 236 } })).toEqual({ side: 'top', maxHeight: null });
  });

  it('兩邊都放不下整個提示：放空間大的那邊，高度限制在那段空間裡', () => {
    const tiny = { viewportHeight: 256, headerBottom: 66, gap: 8, noticeHeight: 120 };
    expect(placeNotice({ ...tiny, anchor: { top: 120, bottom: 164 } })).toEqual({ side: 'bottom', maxHeight: 76 });
    expect(placeNotice({ ...tiny, anchor: { top: 170, bottom: 214 } })).toEqual({ side: 'top', maxHeight: 88 });
  });

  it('掃過各種視窗、提示高度與 anchor 位置：放好的提示從不和 anchor 重疊，放得下時不限高度', () => {
    let checked = 0;
    for (const viewportHeight of [256, 360, 400, 720, 839]) {
      for (const noticeHeight of [40, 61, 82, 120, 200]) {
        for (let top = -50; top < viewportHeight + 10; top += 7) {
          for (const size of [28, 44, 90]) {
            const layout = { viewportHeight, headerBottom: 66, gap: 8, noticeHeight, anchor: { top, bottom: top + size } };
            const n = noticeRect(layout);
            const where = JSON.stringify({ ...layout, n });
            expect(top < n.bottom && top + size > n.top, `重疊 ${where}`).toBe(false);
            expect(n.top >= layout.headerBottom, `蓋到頁首 ${where}`).toBe(true);
            expect(n.bottom <= viewportHeight, `超出視窗 ${where}`).toBe(true);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(3000);
  });
});
