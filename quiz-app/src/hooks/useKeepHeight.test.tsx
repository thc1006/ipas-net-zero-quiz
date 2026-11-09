import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { useKeepHeight } from './useKeepHeight';
import { useAccessibility } from './useAccessibility';

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

  describe('使用者換了字級（設定頁，html 的 data-font-size）', () => {
    const root = document.documentElement;
    afterEach(() => {
      root.removeAttribute('data-font-size');
      root.removeAttribute('data-theme');
    });
    const setAttr = (name: string, value: string) =>
      act(async () => {
        root.setAttribute(name, value);
      });

    it('從現在的內容重新量：字級變小時不留著大字級的高度', async () => {
      root.setAttribute('data-font-size', 'xlarge');
      natural = 60;
      const { rerender } = render(<Line text="長" />);
      natural = 20;
      rerender(<Line text="短" />);
      expect(line().style.minHeight).toBe('60px');
      await setAttr('data-font-size', 'normal');
      expect(line().style.minHeight).toBe('20px');
    });

    it('只換顏色（深色、高對比、色覺模式）：不重新量', async () => {
      natural = 60;
      const { rerender } = render(<Line text="長" />);
      natural = 20;
      rerender(<Line text="短" />);
      await setAttr('data-theme', 'dark');
      await setAttr('data-high-contrast', 'true');
      await setAttr('data-cvd-mode', 'protanopia');
      expect(line().style.minHeight).toBe('60px');
      root.removeAttribute('data-high-contrast');
      root.removeAttribute('data-cvd-mode');
    });

    it('開始看的時候記下現在的字級：沒有段落時換了字級，之後照同一個值再寫一次不重新量', async () => {
      root.setAttribute('data-font-size', 'normal');
      natural = 60;
      const first = render(<Line text="長" />);
      await setAttr('data-font-size', 'normal');
      first.unmount();
      // 沒有段落在看的時候換成特大
      root.setAttribute('data-font-size', 'xlarge');
      const { rerender } = render(<Line text="長" />);
      natural = 20;
      rerender(<Line text="短" />);
      await setAttr('data-font-size', 'xlarge');
      expect(line().style.minHeight).toBe('60px');
    });

    // useAccessibility 每換一個設定都把四個屬性重寫一次，data-font-size 寫的是同一個值也會有 MutationObserver 的紀錄
    describe('走真的設定路徑（useAccessibility）', () => {
      let a11y: ReturnType<typeof useAccessibility>;
      function Settings({ text }: { text: string }) {
        a11y = useAccessibility();
        return <Line text={text} />;
      }
      afterEach(() => {
        localStorage.clear();
        root.removeAttribute('data-high-contrast');
        root.removeAttribute('data-cvd-mode');
      });
      const shortened = async () => {
        natural = 60;
        const view = render(<Settings text="長" />);
        await act(async () => {});
        natural = 20;
        view.rerender(<Settings text="短" />);
        expect(line().style.minHeight).toBe('60px');
      };

      it('頁首切換深色模式：字級沒換，不重新量', async () => {
        await shortened();
        await act(async () => a11y.toggleDarkMode());
        expect(root.getAttribute('data-theme'), '前提：真的換成深色').toBe('dark');
        expect(line().style.minHeight).toBe('60px');
      });

      it('高對比、色覺模式：不重新量', async () => {
        await shortened();
        await act(async () => a11y.toggleHighContrast());
        await act(async () => a11y.setCvdMode('protanopia'));
        expect(root.getAttribute('data-cvd-mode'), '前提：真的換了').toBe('protanopia');
        expect(line().style.minHeight).toBe('60px');
      });

      it('系統換成深色（使用者沒有存過設定，跟著系統）：不重新量', async () => {
        const handlers: ((e: MediaQueryListEvent) => void)[] = [];
        vi.spyOn(window, 'matchMedia').mockImplementation(
          (query: string) =>
            ({
              matches: false,
              media: query,
              addEventListener: (_: string, h: (e: MediaQueryListEvent) => void) => handlers.push(h),
              removeEventListener: () => {},
            }) as unknown as MediaQueryList
        );
        await shortened();
        expect(handlers.length, '前提：useAccessibility 聽了系統的深色設定').toBeGreaterThan(0);
        await act(async () => handlers.forEach((h) => h({ matches: true } as MediaQueryListEvent)));
        expect(root.getAttribute('data-theme'), '前提：真的跟著系統換成深色').toBe('dark');
        expect(line().style.minHeight).toBe('60px');
      });

      it('換字級：重新量', async () => {
        await shortened();
        await act(async () => a11y.setFontSize('xlarge'));
        expect(line().style.minHeight).toBe('20px');
        natural = 10;
        await act(async () => a11y.setFontSize('normal'));
        expect(line().style.minHeight).toBe('10px');
      });
    });

    it('最後一段拿掉之後不再看字級', async () => {
      const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
      natural = 60;
      const { unmount } = render(<Line text="長" />);
      unmount();
      expect(disconnect).toHaveBeenCalledTimes(1);
    });
  });

  // 換了寬度或字級時，按鈕的 min-height、padding、字級照 .btn 的 transition: all 慢慢換（觸控大小在 640px 上下是 44 與 40）：
  // 當下量到的是舊的值。jsdom 沒有 getAnimations，這裡給它
  describe('重新量的時候這幾段裡還有 transition 在跑', () => {
    const root = document.documentElement;
    let running: Animation[];
    const getAnimations = vi.fn((_?: GetAnimationsOptions) => running);
    beforeEach(() => {
      running = [];
      getAnimations.mockClear();
      Object.defineProperty(HTMLElement.prototype, 'getAnimations', { configurable: true, value: getAnimations });
    });
    afterEach(() => {
      delete (HTMLElement.prototype as Partial<HTMLElement>).getAnimations;
      root.removeAttribute('data-font-size');
    });
    const animation = (transition: boolean) => {
      let end = () => {};
      let cancel = () => {};
      const finished = new Promise<void>((resolve, reject) => {
        end = resolve;
        cancel = () => reject(new DOMException('canceled', 'AbortError'));
      });
      finished.catch(() => {});
      const a = (transition ? { transitionProperty: 'min-height', finished } : { animationName: 'fade', finished }) as unknown as Animation;
      return { a, end, cancel };
    };
    const shortened = () => {
      natural = 60;
      const view = render(<Line text="長" />);
      natural = 20;
      view.rerender(<Line text="短" />);
      expect(line().style.minHeight).toBe('60px');
      return view;
    };
    const triggers = {
      換了寬度: () => resize(740, 800),
      換了字級: () => act(async () => root.setAttribute('data-font-size', 'large')),
    };

    for (const [name, trigger] of Object.entries(triggers)) {
      for (const how of ['跑完', '被取消'] as const) {
        it(`${name}：transition ${how}之後照最後的版面再量一次`, async () => {
          shortened();
          const t = animation(true);
          running = [t.a];
          natural = 24;
          await trigger();
          expect(line().style.minHeight, '當下量到的是 transition 還沒跑完的高度').toBe('24px');
          running = [];
          natural = 20;
          await act(async () => (how === '跑完' ? t.end() : t.cancel()));
          expect(line().style.minHeight).toBe('20px');
          // 按鈕在這一段裡面
          expect(getAnimations).toHaveBeenCalledWith({ subtree: true });
        });
      }
    }

    // 畫完量的時候也一樣：說明卡的開關從實心換成框線（btn-primary 換成 btn-secondary），邊框的 transition 還沒跑完，
    // 量到的比最後的高 2px（Firefox 4px）
    describe('畫完量到的是 transition 還沒跑完的高度', () => {
      const grown = (transitional: number) => {
        natural = 60;
        const view = render(<Line text="短" />);
        expect(line().style.minHeight).toBe('60px');
        const t = animation(true);
        running = [t.a];
        natural = transitional;
        view.rerender(<Line text="長" />);
        expect(line().style.minHeight, '當下量到的是 transition 還沒跑完的高度').toBe(`${transitional}px`);
        running = [];
        return { ...view, t };
      };

      it('跑完之後照最後的高度留著', async () => {
        const { t } = grown(70);
        natural = 66;
        await act(async () => t.end());
        expect(line().style.minHeight).toBe('66px');
      });

      it('跑完之後的高度比之前留著的矮：留著之前的', async () => {
        const { t } = grown(62);
        natural = 58;
        await act(async () => t.end());
        expect(line().style.minHeight).toBe('60px');
      });

      it('中間又畫過一次、內容一樣（例如練習池載完）：照樣照最後的高度留著', async () => {
        const { t, rerender } = grown(70);
        rerender(<Line text="長" />);
        natural = 66;
        await act(async () => t.end());
        expect(line().style.minHeight).toBe('66px');
      });

      it('中間內容換了（別的分頁又改了）：不動，寧可多留幾 px', async () => {
        const { t, rerender } = grown(70);
        natural = 40;
        rerender(<Line text="又換了" />);
        expect(line().style.minHeight).toBe('70px');
        await act(async () => t.end());
        expect(line().style.minHeight).toBe('70px');
      });

      it('中間換了寬度、已經照新的寬度量過：不動，不留回之前那個寬度的高度', async () => {
        const { t } = grown(70);
        natural = 50;
        resize(740, 800);
        expect(line().style.minHeight).toBe('50px');
        await act(async () => t.end());
        expect(line().style.minHeight).toBe('50px');
      });
    });

    it('不是 transition 的動畫（進場動畫、一直轉的圖示）不等', async () => {
      shortened();
      const t = animation(false);
      running = [t.a];
      natural = 24;
      resize(740, 800);
      natural = 20;
      await act(async () => t.end());
      expect(line().style.minHeight).toBe('24px');
    });

    it('等的時候又換了寬度：前一次的 transition 跑完不再量（之後別的分頁讓它變短，留著的高度不能被量掉）', async () => {
      shortened();
      const t = animation(true);
      running = [t.a];
      natural = 24;
      resize(740, 800);
      running = [];
      natural = 22;
      resize(800, 900);
      expect(line().style.minHeight).toBe('22px');
      natural = 20;
      await act(async () => t.end());
      expect(line().style.minHeight).toBe('22px');
    });
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
