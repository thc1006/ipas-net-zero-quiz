import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { useKeepHeight } from './useKeepHeight';

// jsdom 沒有排版：高度照測試給的，視窗寬度改 innerWidth、innerHeight
let natural = 0;
function Line({ text, scope = null }: { text: string; scope?: unknown }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useKeepHeight(ref, scope);
  return <p ref={ref}>{text}</p>;
}
const line = () => document.querySelector('p') as HTMLElement;
const resize = (width: number, height: number) =>
  act(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
    window.dispatchEvent(new Event('resize'));
  });

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    // min-height 撐著的時候量到的是 min-height 與內容高的大的那一個
    const min = parseFloat(this.style.minHeight) || 0;
    return { height: Math.max(natural, min) } as DOMRect;
  });
  resize(1280, 800);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useKeepHeight', () => {
  it('換成比較短的內容：留在最高的時候；scope 換了從頭量', () => {
    natural = 60;
    const { rerender } = render(<Line text="長" />);
    expect(line().style.minHeight).toBe('60px');
    natural = 20;
    rerender(<Line text="短" />);
    expect(line().style.minHeight).toBe('60px');
    rerender(<Line text="短" scope="換了" />);
    expect(line().style.minHeight).toBe('20px');
  });

  it('視窗寬度換了：從現在的內容重新量，之後照新的高度留著', () => {
    natural = 60;
    const { rerender } = render(<Line text="長" />);
    natural = 20;
    rerender(<Line text="短" />);
    expect(line().style.minHeight).toBe('60px');
    resize(740, 800);
    expect(line().style.minHeight).toBe('20px');
    natural = 40;
    rerender(<Line text="中" />);
    expect(line().style.minHeight).toBe('40px');
    natural = 20;
    rerender(<Line text="短" />);
    expect(line().style.minHeight).toBe('40px');
  });

  it('只有高度換了（手機網址列收起來）：不重新量', () => {
    natural = 60;
    const { rerender } = render(<Line text="長" />);
    natural = 20;
    rerender(<Line text="短" />);
    resize(1280, 700);
    expect(line().style.minHeight).toBe('60px');
  });

  it('橫向與直向互換：寬度一樣也重新量', () => {
    resize(800, 700);
    natural = 60;
    const { rerender } = render(<Line text="長" />);
    natural = 20;
    rerender(<Line text="短" />);
    resize(800, 900);
    expect(line().style.minHeight).toBe('20px');
  });

  it('拿掉之後不再聽 resize', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    natural = 60;
    const { unmount } = render(<Line text="長" />);
    unmount();
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('好幾段：只聽一個 resize，先全部清掉、再全部量、最後全部寫回（量的時候沒有一段還撐著）', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    natural = 60;
    const { rerender, unmount } = render(
      <>
        {[1, 2, 3, 4].map((i) => (
          <Line key={i} text="長" />
        ))}
      </>
    );
    const resizeCalls = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === 'resize').length;
    expect(resizeCalls(add)).toBe(1);
    natural = 20;
    rerender(
      <>
        {[1, 2, 3, 4].map((i) => (
          <Line key={i} text="短" />
        ))}
      </>
    );
    const lines = [...document.querySelectorAll('p')];
    expect(lines.map((p) => p.style.minHeight)).toEqual(['60px', '60px', '60px', '60px']);
    // 量的時候每一段的 min-height 都已經清掉：清一段、量一段、寫一段的話，量第二段時第一段已經寫回去
    const seen: string[][] = [];
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      seen.push(lines.map((p) => p.style.minHeight));
      const min = parseFloat(this.style.minHeight) || 0;
      return { height: Math.max(natural, min) } as DOMRect;
    });
    resize(740, 800);
    expect(seen).toEqual([['', '', '', ''], ['', '', '', ''], ['', '', '', ''], ['', '', '', '']]);
    expect(lines.map((p) => p.style.minHeight)).toEqual(['20px', '20px', '20px', '20px']);
    unmount();
    expect(resizeCalls(remove)).toBe(1);
  });

  it('一段拿掉、其他段還在：還在的照樣在視窗寬度換了時重新量', () => {
    natural = 60;
    const { rerender } = render(
      <>
        <Line key="a" text="長" />
        <Line key="b" text="長" />
      </>
    );
    natural = 20;
    const kept = document.querySelectorAll('p')[1];
    rerender(
      <>
        <Line key="b" text="短" />
      </>
    );
    expect(line()).toBe(kept);
    expect(line().style.minHeight).toBe('60px');
    resize(740, 800);
    expect(line().style.minHeight).toBe('20px');
  });
});
