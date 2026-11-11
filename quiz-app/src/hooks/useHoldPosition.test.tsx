import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { useHoldPosition } from './useHoldPosition';

// jsdom 不排版：按鈕的位置是「上面那一段的高度 − 捲動位置」。上面那一段的高度跟著畫面換（第 n 次畫用 heights[n]），
// transition 跑到一半的變化由測試加在 extra。頁首 60px、視窗 700px
let extra: number;
let scrollY: number;
let scrollBy: ReturnType<typeof vi.fn>;
const above = () => Number(document.querySelector('[data-above]')!.getAttribute('data-above')) + extra;

function Harness({ reveal = false, show = true, heights = [500] }: { reveal?: boolean; show?: boolean; heights?: number[] }) {
  const hold = useHoldPosition(reveal);
  const [n, setN] = useState(0);
  return (
    <>
      <header className="app-header" />
      <div data-above={heights[Math.min(n, heights.length - 1)]} />
      {show && (
        <button type="button" onClick={(e) => (hold(e.currentTarget), setN(n + 1))}>
          換 {n}
        </button>
      )}
      <button type="button" onClick={(e) => hold(e.currentTarget)}>
        不重畫
      </button>
      <button type="button" onClick={() => setN(n + 1)}>
        別的原因重畫
      </button>
    </>
  );
}

const button = (name: RegExp) => screen.getByRole('button', { name });

beforeEach(() => {
  extra = 0;
  scrollY = 300;
  scrollBy = vi.fn((_x: number, y: number) => {
    scrollY += y;
  });
  vi.stubGlobal('scrollBy', scrollBy);
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 700 });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.matches('.app-header')) return { top: 0, bottom: 60, height: 60 } as DOMRect;
    const top = above() - scrollY;
    return { top, bottom: top + 40, height: 40 } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 0 });
});

describe('useHoldPosition', () => {
  it('上面長高、變矮：畫完時捲回原來的位置', () => {
    render(<Harness heights={[500, 564, 474]} />);
    for (const delta of [64, -90]) {
      const before = button(/^換/).getBoundingClientRect().top;
      fireEvent.click(button(/^換/));
      expect(scrollBy).toHaveBeenLastCalledWith(0, delta);
      expect(button(/^換/).getBoundingClientRect().top).toBe(before);
    }
  });

  it('沒有移動：不捲', () => {
    render(<Harness />);
    fireEvent.click(button(/^換/));
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('沒有重畫：記下的位置不留到之後別的原因重畫才捲', async () => {
    render(<Harness heights={[500, 550]} />);
    fireEvent.click(button(/不重畫/));
    await act(() => new Promise((r) => setTimeout(r)));
    fireEvent.click(button(/別的原因/));
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('畫完時元素已經不在：不捲', () => {
    const { rerender } = render(<Harness heights={[500, 550]} />);
    const el = button(/^換/);
    // 記下之後、畫之前拿掉
    act(() => {
      el.click();
      rerender(<Harness heights={[500, 550]} show={false} />);
    });
    expect(el.isConnected).toBe(false);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('reveal：捲回原來的位置之後被頁首蓋住，再往下露出來', () => {
    render(<Harness reveal heights={[500, 510]} />);
    scrollY = 500 - 62; // 上緣在頁首下面 2px
    const el = button(/^換/);
    // 頁首變高 20px：原來的位置現在在頁首底下
    const header = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
    const base = header.getMockImplementation()!;
    header.mockImplementation(function (this: HTMLElement) {
      return this.matches('.app-header') ? ({ top: 0, bottom: 80, height: 80 } as DOMRect) : base.call(this);
    });
    fireEvent.click(el);
    expect(scrollBy.mock.calls).toEqual([
      [0, 10],
      [0, -18],
    ]);
  });

  it('沒有 reveal：被頁首蓋住也只捲回原來的位置', () => {
    render(<Harness heights={[500, 510]} />);
    scrollY = 500 - 62;
    const el = button(/^換/);
    // 頁首變高 20px
    const header = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
    const base = header.getMockImplementation()!;
    header.mockImplementation(function (this: HTMLElement) {
      return this.matches('.app-header') ? ({ top: 0, bottom: 80, height: 80 } as DOMRect) : base.call(this);
    });
    fireEvent.click(el);
    expect(scrollBy.mock.calls).toEqual([[0, 10]]);
  });

  describe('上面有 transition 在跑：跑完之前每個 frame 捲回去，跑完再捲一次', () => {
    let finish: () => void;
    let frames: FrameRequestCallback[];
    beforeEach(() => {
      const finished = new Promise<void>((r) => (finish = r));
      const transition = { transitionProperty: 'padding', finished } as unknown as Animation;
      const animation = { finished: new Promise(() => {}) } as unknown as Animation;
      document.getAnimations = () => [transition, animation];
      frames = [];
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
      vi.stubGlobal('cancelAnimationFrame', (id: number) => (frames[id - 1] = () => {}));
    });
    afterEach(() => {
      delete (document as { getAnimations?: unknown }).getAnimations;
    });
    const frame = () => act(() => frames[frames.length - 1](0));

    it('每個 frame 補上面又換的高度；跑完之後補最後一次，不再排 frame', async () => {
      render(<Harness />);
      fireEvent.click(button(/^換/));
      expect(scrollBy).not.toHaveBeenCalled();
      extra += 3;
      frame();
      expect(scrollBy).toHaveBeenLastCalledWith(0, 3);
      extra -= 1;
      frame();
      expect(scrollBy).toHaveBeenLastCalledWith(0, -1);
      extra += 2;
      await act(async () => finish());
      expect(scrollBy).toHaveBeenLastCalledWith(0, 2);
      const count = frames.length;
      frames[count - 1](0);
      expect(scrollBy).toHaveBeenCalledTimes(3);
    });

    it.each(['wheel', 'touchmove', 'keydown', 'pointerdown'])('中間使用者 %s：之後都不捲', async (type) => {
      render(<Harness />);
      fireEvent.click(button(/^換/));
      window.dispatchEvent(new Event(type));
      extra += 5;
      frame();
      await act(async () => finish());
      expect(scrollBy).not.toHaveBeenCalled();
    });

    it('中間又換了一次：前一次的不再捲', async () => {
      render(<Harness />);
      fireEvent.click(button(/^換/));
      const first = frames.length;
      fireEvent.click(button(/不重畫/));
      extra += 5;
      act(() => frames[first - 1](0));
      await act(async () => finish());
      expect(scrollBy).not.toHaveBeenCalled();
    });
  });
});
