// Header：回報問題（GitHub issue）與討論區（GitHub Discussions）是兩個分開、各自有名稱的入口
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Header } from './Header';
import { useAccessibility } from '../../hooks/useAccessibility';
import { DISCUSSIONS_URL, REPORT_URL } from '../../utils/feedback-url';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function HeaderHarness() {
  const accessibility = useAccessibility();
  return <Header accessibility={accessibility} onOpenSettings={() => {}} onGoHome={() => {}} />;
}

describe('Header 的回報問題與討論區', () => {
  it('功能選單裡有兩個連結：回報問題開 issue 範本選單，討論區開 Discussions', () => {
    render(<HeaderHarness />);
    const nav = screen.getByRole('navigation', { name: '功能選單' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => [link.getAttribute('aria-label'), link.getAttribute('href')])).toEqual([
      ['回報問題', REPORT_URL],
      ['討論區', DISCUSSIONS_URL],
    ]);
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      // 名稱跟畫面上的字一樣（寬螢幕顯示字，窄螢幕只剩圖示）
      expect(link).toHaveTextContent(link.getAttribute('aria-label')!);
      expect(link).toHaveAttribute('title', link.getAttribute('aria-label'));
      // 圖示不唸出來
      for (const icon of link.querySelectorAll('.material-icons, svg')) {
        expect(icon).toHaveAttribute('aria-hidden', 'true');
      }
    }
  });

  it('依名稱找得到兩個入口，沒有合在一起的舊入口', () => {
    render(<HeaderHarness />);
    expect(screen.getByRole('link', { name: '回報問題' })).toHaveAttribute('href', REPORT_URL);
    expect(screen.getByRole('link', { name: '討論區' })).toHaveAttribute('href', DISCUSSIONS_URL);
    expect(screen.queryByRole('link', { name: /社群討論|回報題目/ })).toBeNull();
  });

  it('既有的按鈕不受影響', () => {
    render(<HeaderHarness />);
    expect(screen.getByRole('button', { name: '回首頁' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '開啟設定' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /切換(深色|淺色)模式/ })).toBeInTheDocument();
  });
});

describe('鍵盤移動焦點之後的補捲', () => {
  // 焦點移動之前的那一下 Tab：瀏覽器在 keydown 的同一個 task 裡移動焦點
  const tab = (init: KeyboardEventInit = {}) =>
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', ...init });
  function Page() {
    return (
      <>
        <HeaderHarness />
        <button type="button">頁面上的按鈕</button>
      </>
    );
  }

  for (const [name, act] of [
    ['按鍵', () => fireEvent.keyDown(document.body, { key: ' ' })],
    ['按下指標', () => fireEvent.pointerDown(document.body)],
  ] as const) {
    it(`下一個${name}之前還沒跑到的就不跑：頁面可能已經被別的東西捲過`, () => {
      const request = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(7);
      const cancel = vi.spyOn(window, 'cancelAnimationFrame');
      render(<Page />);
      tab();
      fireEvent.focusIn(screen.getByRole('button', { name: '頁面上的按鈕' }));
      expect(request).toHaveBeenCalledTimes(1);
      cancel.mockClear();
      act();
      expect(cancel).toHaveBeenCalledWith(7);
    });
  }

  // capture：頁面上的元素把按鍵、按下指標的事件攔下來（stopPropagation）也一樣取消
  for (const [name, type] of [
    ['按鍵', 'keydown'],
    ['按下指標', 'pointerdown'],
  ] as const) {
    it(`${name}被頁面上的元素攔下來也取消（document 上的 listener 是 capture）`, () => {
      vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(7);
      const cancel = vi.spyOn(window, 'cancelAnimationFrame');
      render(<Page />);
      const button = screen.getByRole('button', { name: '頁面上的按鈕' });
      button.addEventListener(type, (e) => e.stopPropagation());
      tab();
      fireEvent.focusIn(button);
      cancel.mockClear();
      if (type === 'keydown') fireEvent.keyDown(button, { key: ' ' });
      else fireEvent.pointerDown(button);
      expect(cancel).toHaveBeenCalledWith(7);
    });
  }

  describe('跑到的時候', () => {
    let frames: Map<number, FrameRequestCallback>;
    let top: number;
    let visible: boolean;
    const button = () => screen.getByRole('button', { name: '頁面上的按鈕' });
    const runFrames = () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((f) => f(0));
    };
    const focusAndRun = (init?: KeyboardEventInit) => {
      button().blur();
      tab(init);
      button().focus();
      runFrames();
    };

    function setup() {
      frames = new Map();
      let next = 0;
      top = 0;
      visible = true;
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((f) => {
        frames.set(++next, f);
        return next;
      });
      vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
        frames.delete(id);
      });
      const matches = Element.prototype.matches;
      vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
        return selector === ':focus-visible' ? visible : matches.call(this, selector);
      });
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
        () => ({ top, bottom: top + 40, height: 40 }) as DOMRect
      );
      // jsdom 沒有排版：視窗高 600
      vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(600);
      vi.mocked(Element.prototype.scrollIntoView).mockClear();
      render(<Page />);
    }

    it('焦點在頁首底下（上緣在 scroll-padding-top 以上）：捲到剛好露出來', () => {
      setup();
      top = -10;
      focusAndRun();
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
      expect(vi.mocked(Element.prototype.scrollIntoView).mock.instances[0]).toBe(button());
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    });

    it('焦點一部分在視窗底邊下面（Firefox、WebKit 往下 Tab 時只捲到一部分露出來）：捲到剛好露出來', () => {
      setup();
      top = 575;
      focusAndRun();
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
      expect(vi.mocked(Element.prototype.scrollIntoView).mock.instances[0]).toBe(button());
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    });

    it('下緣差不到 1px（位置有小數）：不捲', () => {
      setup();
      top = 560.5;
      focusAndRun();
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });

    it('同一個 frame 裡焦點走了又回來：只補捲一次（新的排進來時取消舊的）', () => {
      setup();
      top = -10;
      const other = document.createElement('button');
      document.body.append(other);
      try {
        tab();
        button().focus();
        other.focus();
        button().focus();
        runFrames();
        expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
      } finally {
        other.remove();
      }
    });

    it('已經露出來、不是 :focus-visible（滑鼠點的）、焦點已經換走：不捲', () => {
      setup();
      top = 100;
      focusAndRun();
      top = -10;
      visible = false;
      focusAndRun();
      visible = true;
      button().blur();
      tab();
      button().focus();
      button().blur();
      runFrames();
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });

    it('Shift+Tab：一樣補捲', () => {
      setup();
      top = -10;
      focusAndRun({ shiftKey: true });
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it('方向鍵在 radio 之間移動焦點：一樣補捲', () => {
      setup();
      for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
        top = key === 'ArrowDown' || key === 'ArrowRight' ? 575 : -10;
        focusAndRun({ key });
      }
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(4);
    });

    // 別的分頁改了名單時 RemoveFromReview 用 focus({ preventScroll: true }) 把焦點放回那一列；視窗拿回焦點時瀏覽器把
    // 焦點還給原來的元素（Chromium 有視窗時）。都不是使用者移動焦點，頁面不能捲
    it('不是按鍵移過去的焦點（程式呼叫 focus、視窗拿回焦點）：上緣在頁首底下、下緣在視窗底邊下面都不捲', () => {
      setup();
      for (const at of [-10, 575]) {
        top = at;
        button().blur();
        window.dispatchEvent(new FocusEvent('focus'));
        button().focus();
        runFrames();
      }
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });

    it('按了 Tab、焦點在之後的 task 才移動：不算按鍵移過去的', async () => {
      setup();
      top = -10;
      button().blur();
      tab();
      await new Promise((resolve) => setTimeout(resolve, 0));
      button().focus();
      runFrames();
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });

    // 瀏覽器在 keydown 的 listener 跑完之後先跑 microtask，再移動焦點：重設不能排在 microtask
    it('keydown 之後的 microtask 跑完才移動焦點：照樣補捲', async () => {
      setup();
      top = -10;
      button().blur();
      tab();
      await Promise.resolve();
      await Promise.resolve();
      button().focus();
      runFrames();
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it('Tab 之後、重設之前又按了別的鍵（Enter 換畫面時程式移動焦點）：不算', () => {
      setup();
      top = -10;
      button().blur();
      tab();
      fireEvent.keyDown(document.body, { key: 'Enter' });
      button().focus();
      runFrames();
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });

    it('Ctrl、Alt、Meta 加 Tab（切換瀏覽器分頁、視窗）、其他按鍵：不算', () => {
      setup();
      top = -10;
      for (const init of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { key: 'Enter' }, { key: ' ' }]) {
        focusAndRun(init);
      }
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });
  });
});
