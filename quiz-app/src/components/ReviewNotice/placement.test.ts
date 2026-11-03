// 提示選邊：不論視窗多矮、提示多高、anchor 在哪裡，放好的提示都讀得到，anchor 也不會整個被蓋住；
// 有地方放的時候兩者不重疊。真的排版在 star-review.spec.ts 驗。
import { describe, expect, it } from 'vitest';
import { placeNotice, type NoticeLayout } from './placement';

const base: Omit<NoticeLayout, 'anchor'> = { viewportHeight: 839, headerBottom: 57, gap: 8, noticeHeight: 61, minHeight: 61 };

/** 放好之後提示在視窗裡佔的範圍 */
function noticeRect(layout: NoticeLayout) {
  const { side, maxHeight } = placeNotice(layout);
  const height = Math.min(layout.noticeHeight, maxHeight ?? Infinity);
  const top = side === 'top' ? layout.headerBottom + layout.gap : layout.viewportHeight - layout.gap - height;
  return { side, top, bottom: top + height, height, capped: maxHeight !== null };
}

/** anchor 沒被頁首、提示蓋住，又在視窗裡的長度 */
function anchorShown(layout: NoticeLayout, n: { top: number; bottom: number }) {
  const a = layout.anchor!;
  const length = (top: number, bottom: number) => Math.max(0, Math.min(a.bottom, bottom) - Math.max(a.top, top));
  // 頁首下面、視窗裡的那一段，扣掉提示蓋住的
  const inView = length(layout.headerBottom, layout.viewportHeight);
  return inView - length(Math.max(n.top, layout.headerBottom), Math.min(n.bottom, layout.viewportHeight));
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
    const tiny = { viewportHeight: 256, headerBottom: 66, gap: 8, noticeHeight: 74, minHeight: 74 };
    expect(placeNotice({ ...tiny, anchor: { top: 192, bottom: 236 } })).toEqual({ side: 'top', maxHeight: null });
  });

  it('兩邊都放不下整個提示：放空間大的那邊，高度限制在那段空間裡', () => {
    const tiny = { viewportHeight: 256, headerBottom: 66, gap: 8, noticeHeight: 120, minHeight: 60 };
    expect(placeNotice({ ...tiny, anchor: { top: 120, bottom: 164 } })).toEqual({ side: 'bottom', maxHeight: 76 });
    expect(placeNotice({ ...tiny, anchor: { top: 170, bottom: 214 } })).toEqual({ side: 'top', maxHeight: 88 });
    // 兩邊都放得下兩行：選空間大的上面，不是先試的底部
    expect(placeNotice({ ...tiny, minHeight: 40, anchor: { top: 160, bottom: 175 } })).toEqual({ side: 'top', maxHeight: 78 });
  });

  // 320x256（1280x1024 放大 400%）字級特大：鍵盤按下一題之後焦點在題幹，第 10 題的題幹比頁首下面的空間還高。
  // 改之前兩邊都算成負的空間，提示的高度上限是 0，字整個看不到
  it('anchor 比可用的高度還高：提示至少留兩行，題幹露出其餘的部分', () => {
    const tiny = { viewportHeight: 256, headerBottom: 66, gap: 8, noticeHeight: 103, minHeight: 74 };
    for (let top = 40; top <= 110; top += 2) {
      const layout = { ...tiny, anchor: { top, bottom: top + 300 } };
      const n = noticeRect(layout);
      const where = JSON.stringify({ ...layout, n });
      expect(n.height, `提示讀不到 ${where}`).toBeGreaterThanOrEqual(74);
      expect(anchorShown(layout, n), `題幹整個被蓋住 ${where}`).toBeGreaterThan(0);
    }
  });

  it('只是捲動（stay）：anchor 兩邊都會被蓋到時留在原本那一邊，不跟著換邊', () => {
    const tiny = { viewportHeight: 256, headerBottom: 66, gap: 8, noticeHeight: 103, minHeight: 74 };
    for (let top = -200; top <= 110; top += 4) {
      for (const stay of ['top', 'bottom'] as const) {
        const layout = { ...tiny, anchor: { top, bottom: top + 300 }, stay };
        const { side } = placeNotice(layout);
        const other = stay === 'top' ? 'bottom' : 'top';
        // 換邊只在換過去的那一邊完全不蓋到 anchor、原本那一邊會蓋到的時候
        if (side !== stay) {
          const n = noticeRect(layout);
          expect(anchorShown(layout, n), `換到 ${other} 還是蓋到 ${JSON.stringify(layout)}`).toBe(
            Math.min(layout.anchor.bottom, 256) - Math.max(layout.anchor.top, 66)
          );
        }
      }
    }
  });

  it('只是捲動（stay）：anchor 不在畫面上時也留在原本那一邊', () => {
    expect(placeNotice({ ...base, anchor: null, stay: 'top' })).toEqual({ side: 'top', maxHeight: null });
    expect(placeNotice({ ...base, anchor: { top: -80, bottom: -36 }, stay: 'top' })).toEqual({ side: 'top', maxHeight: null });
  });

  it('新按的或新拿到焦點的元素（沒有 stay）：照預設先試底部', () => {
    const tiny = { viewportHeight: 256, headerBottom: 66, gap: 8, noticeHeight: 103, minHeight: 74 };
    // 題幹從頁首下面開始，往下超出視窗：兩邊都會蓋到，放底部，題幹的開頭留著
    expect(placeNotice({ ...tiny, anchor: { top: 98, bottom: 398 } }).side).toBe('bottom');
  });

  it('兩邊連最少的兩行都會把 anchor 整個蓋住：提示縮到讓 anchor 露出 24px（或整個 anchor），選縮得少的那邊', () => {
    const tiny = { viewportHeight: 256, headerBottom: 66, gap: 8, noticeHeight: 120, minHeight: 100 };
    const layout = { ...tiny, anchor: { top: 150, bottom: 174 } };
    const n = noticeRect(layout);
    expect(anchorShown(layout, n)).toBe(24);
    expect(placeNotice(layout)).toEqual({ side: 'top', maxHeight: 76 });
  });

  it('掃過各種視窗、提示高度、最少高度與 anchor 位置：提示讀得到、anchor 不被整個蓋住，有地方放時不重疊', () => {
    let checked = 0;
    let overlapped = 0;
    for (const viewportHeight of [192, 256, 360, 400, 720, 839]) {
      for (const noticeHeight of [40, 61, 82, 120, 200]) {
        for (const minFrac of [0.4, 0.7, 1]) {
          const minHeight = Math.round(noticeHeight * minFrac);
          for (let top = -50; top < viewportHeight + 10; top += 7) {
            for (const size of [28, 44, 90, 400]) {
              for (const stay of [undefined, 'top', 'bottom'] as const) {
                const headerBottom = 66;
                const gap = 8;
                const layout = { viewportHeight, headerBottom, gap, noticeHeight, minHeight, stay, anchor: { top, bottom: top + size } };
                const n = noticeRect(layout);
                const where = JSON.stringify({ ...layout, n });
                const room = viewportHeight - headerBottom - 2 * gap;
                expect(n.top >= headerBottom, `蓋到頁首 ${where}`).toBe(true);
                expect(n.bottom <= viewportHeight, `超出視窗 ${where}`).toBe(true);

                const visibleTop = Math.max(top, headerBottom);
                const visibleBottom = Math.min(top + size, viewportHeight);
                const visible = visibleBottom - visibleTop;
                const overlap = top < n.bottom && top + size > n.top;
                // 有一邊放得下至少兩行又不碰到 anchor：不能重疊
                const least = Math.min(minHeight, noticeHeight, room);
                const avoidable =
                  visible <= 0 ||
                  visibleTop - (headerBottom + gap) >= least ||
                  viewportHeight - gap - visibleBottom >= least;
                if (avoidable) expect(overlap, `可以不重疊卻重疊 ${where}`).toBe(false);
                if (overlap) overlapped += 1;
                if (visible > 0) {
                  expect(anchorShown(layout, n), `anchor 整個被蓋住 ${where}`).toBeGreaterThanOrEqual(Math.min(24, visible));
                }
                // 提示至少兩行（或整個提示，或頁首與視窗之間的全部空間）；比這矮只能是兩邊放兩行都會讓 anchor 露不到 24px
                if (n.height < Math.floor(least)) {
                  for (const top of [headerBottom + gap, viewportHeight - gap - least]) {
                    expect(anchorShown(layout, { top, bottom: top + least }), `提示讀不到 ${where}`).toBeLessThan(Math.min(24, visible));
                  }
                }
                checked += 1;
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(30000);
    expect(overlapped).toBeGreaterThan(100);
  });
});
