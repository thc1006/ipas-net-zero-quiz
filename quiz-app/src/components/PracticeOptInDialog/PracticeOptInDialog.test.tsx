// PracticeOptInDialog 元件測試（焦點陷阱 / ESC / overlay click / aria）
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { PracticeOptInDialog } from './PracticeOptInDialog';

afterEach(() => cleanup());

describe('PracticeOptInDialog', () => {
  it('renders nothing when not open', () => {
    const { container } = render(
      <PracticeOptInDialog open={false} onAccept={() => {}} onDecline={() => {}} />
    );
    expect(container.querySelector('.optin-dialog')).toBeNull();
  });

  it('renders dialog with role and aria-labelledby/-describedby', () => {
    render(<PracticeOptInDialog open onAccept={() => {}} onDecline={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'optin-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'optin-desc');
    expect(document.getElementById('optin-title')).toHaveTextContent('啟用加強練習池');
    expect(document.getElementById('optin-desc')).toBeInTheDocument();
  });

  it('calls onAccept when accept button clicked', () => {
    const onAccept = vi.fn();
    render(<PracticeOptInDialog open onAccept={onAccept} onDecline={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /我已了解/ }));
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it('calls onDecline when decline button clicked', () => {
    const onDecline = vi.fn();
    render(<PracticeOptInDialog open onAccept={() => {}} onDecline={onDecline} />);
    fireEvent.click(screen.getByRole('button', { name: /暫不啟用/ }));
    expect(onDecline).toHaveBeenCalledOnce();
  });

  it('calls onDecline when ESC pressed', () => {
    const onDecline = vi.fn();
    render(<PracticeOptInDialog open onAccept={() => {}} onDecline={onDecline} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDecline).toHaveBeenCalledOnce();
  });

  it('calls onDecline when overlay (not dialog) clicked', () => {
    const onDecline = vi.fn();
    const { container } = render(
      <PracticeOptInDialog open onAccept={() => {}} onDecline={onDecline} />
    );
    const overlay = container.querySelector('.optin-overlay') as HTMLElement;
    // 直接點擊 overlay：jsdom 會自動把 e.target 設為被點的元素（overlay 自己），
    // 觸發程式碼裡 e.target === e.currentTarget 的判斷
    fireEvent.click(overlay);
    expect(onDecline).toHaveBeenCalledOnce();
  });

  it('does NOT call onDecline when clicking inside the dialog', () => {
    const onDecline = vi.fn();
    render(<PracticeOptInDialog open onAccept={() => {}} onDecline={onDecline} />);
    fireEvent.click(screen.getByText(/公開模擬題（非官方試題）/));
    expect(onDecline).not.toHaveBeenCalled();
  });

  it('focuses first focusable element on open', async () => {
    render(<PracticeOptInDialog open onAccept={() => {}} onDecline={() => {}} />);
    const decline = screen.getByRole('button', { name: /暫不啟用/ });
    // useEffect 在 jsdom 中時機可能不確定；用 waitFor 容錯
    await waitFor(() => {
      expect(document.activeElement).toBe(decline);
    });
  });

  describe('開啟時把對話框捲到按鈕', () => {
    // jsdom 不排版，scrollTop 寫了讀回來還是 0，所以看有沒有寫到對話框上
    afterEach(() => vi.restoreAllMocks());

    it('focus 不自己捲；畫第一個畫面前把對話框捲到底', async () => {
      const focus = vi.spyOn(HTMLElement.prototype, 'focus');
      const scrollTop = vi.spyOn(Element.prototype, 'scrollTop', 'set');
      render(<PracticeOptInDialog open onAccept={() => {}} onDecline={() => {}} />);
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
      await new Promise((ok) => requestAnimationFrame(ok));
      expect(scrollTop.mock.contexts).toEqual([document.querySelector('.optin-dialog')]);
    });

    it('第一個畫面之前就關掉：不再捲', async () => {
      const scrollTop = vi.spyOn(Element.prototype, 'scrollTop', 'set');
      const { rerender } = render(<PracticeOptInDialog open onAccept={() => {}} onDecline={() => {}} />);
      rerender(<PracticeOptInDialog open={false} onAccept={() => {}} onDecline={() => {}} />);
      await new Promise((ok) => requestAnimationFrame(ok));
      expect(scrollTop).not.toHaveBeenCalled();
    });
  });

  describe('Tab 焦點陷阱', () => {
    // 對話框裡可以 Tab 到的依序是內文捲動區、暫不啟用、我已了解。fireEvent 回傳 false 表示預設行為被攔下
    function setup() {
      render(<PracticeOptInDialog open onAccept={() => {}} onDecline={() => {}} />);
      return {
        dialog: document.querySelector('.optin-dialog') as HTMLElement,
        body: document.querySelector('.optin-body') as HTMLElement,
        decline: screen.getByRole('button', { name: /暫不啟用/ }),
        accept: screen.getByRole('button', { name: /我已了解/ }),
      };
    }

    it('在最後一顆按鈕按 Tab，繞回第一個', () => {
      const { body, accept } = setup();
      accept.focus();
      expect(fireEvent.keyDown(document, { key: 'Tab' })).toBe(false);
      expect(document.activeElement).toBe(body);
    });

    it('在第一個按 Shift+Tab，繞到最後一顆按鈕', () => {
      const { body, accept } = setup();
      body.focus();
      expect(fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })).toBe(false);
      expect(document.activeElement).toBe(accept);
    });

    it('焦點在對話框本身（點了空白處）時，Tab 接回第一個、Shift+Tab 接回最後一個', () => {
      const { dialog, body, accept } = setup();
      dialog.focus();
      expect(fireEvent.keyDown(document, { key: 'Tab' })).toBe(false);
      expect(document.activeElement).toBe(body);
      dialog.focus();
      expect(fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })).toBe(false);
      expect(document.activeElement).toBe(accept);
    });

    it('在中間的按鈕按 Tab 或 Shift+Tab，交給瀏覽器照常移動', () => {
      const { decline } = setup();
      decline.focus();
      expect(fireEvent.keyDown(document, { key: 'Tab' })).toBe(true);
      expect(fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })).toBe(true);
      expect(document.activeElement).toBe(decline);
    });

    it('其他按鍵不攔，也不關閉對話框（焦點在最後一顆按鈕，當成 Tab 就會被拉走）', () => {
      const onDecline = vi.fn();
      render(<PracticeOptInDialog open onAccept={() => {}} onDecline={onDecline} />);
      const accept = screen.getByRole('button', { name: /我已了解/ });
      accept.focus();
      for (const key of ['a', 'Enter', 'ArrowDown']) {
        expect(fireEvent.keyDown(document, { key }), key).toBe(true);
      }
      expect(document.activeElement).toBe(accept);
      expect(onDecline).not.toHaveBeenCalled();
    });
  });

  it('does NOT set aria-hidden on #root (relies on aria-modal=true on dialog itself)', () => {
    // 故意不設 aria-hidden — dialog 是 #root 的子孫，若把 #root aria-hidden=true，
    // dialog 本身也會被視為隱藏，導致 a11y tree 找不到 dialog。
    // aria-modal="true" 已足以告知 SR 把 modal 外的內容當 inert。
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);

    render(<PracticeOptInDialog open onAccept={() => {}} onDecline={() => {}} />);
    expect(root.getAttribute('aria-hidden')).toBeNull();

    // dialog 本身仍可透過 role + aria-modal 找到
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    document.body.removeChild(root);
  });
});
