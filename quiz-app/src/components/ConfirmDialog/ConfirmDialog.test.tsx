// 確認對話框：動作不能復原，所以預設焦點在取消，Tab 出不去，關閉後焦點回到原按鈕
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

function Harness({ onConfirm = () => {} }: { onConfirm?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打開
      </button>
      <button type="button">後面的按鈕</button>
      {open && (
        <ConfirmDialog
          title="清除？"
          confirmLabel="確定清除"
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            setOpen(false);
            onConfirm();
          }}
        >
          不能復原
        </ConfirmDialog>
      )}
    </>
  );
}

function openDialog(onConfirm?: () => void) {
  render(<Harness onConfirm={onConfirm} />);
  const opener = screen.getByRole('button', { name: '打開' });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole('dialog');
  return {
    opener,
    dialog,
    cancel: within(dialog).getByRole('button', { name: '取消' }),
    confirm: within(dialog).getByRole('button', { name: '確定清除' }),
  };
}

afterEach(cleanup);

describe('ConfirmDialog', () => {
  it('aria-modal、有標題；預設焦點在取消', () => {
    const { dialog, cancel } = openDialog();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('清除？');
    expect(cancel).toHaveFocus();
  });

  it('Tab 留在對話框裡：最後一個回到第一個', () => {
    const { cancel, confirm } = openDialog();
    confirm.focus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(cancel).toHaveFocus();
  });

  it('Shift+Tab 從第一個回到最後一個', () => {
    const { cancel, confirm } = openDialog();
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
  });

  it('中間的 Tab 交給瀏覽器', () => {
    const { cancel } = openDialog();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    cancel.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('焦點跑到對話框外面時（點了背景之外的地方）拉回來', () => {
    const { cancel } = openDialog();
    const outside = screen.getByRole('button', { name: '後面的按鈕', hidden: true });
    outside.focus();
    fireEvent.keyDown(outside, { key: 'Tab' });
    expect(cancel).toHaveFocus();
  });

  it('取消：焦點回到原按鈕', () => {
    const { opener, cancel } = openDialog();
    fireEvent.click(cancel);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('確定：呼叫 onConfirm，焦點回到原按鈕', () => {
    const onConfirm = vi.fn();
    const { opener, confirm } = openDialog(onConfirm);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
  });

  it('Esc 取消，焦點回到原按鈕', () => {
    const { opener } = openDialog();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  // 開著時後面的頁面捲得動：原按鈕已經捲到視窗外，焦點放回去之後捲最少的距離，focus 自己不捲
  it('關閉時原按鈕在視窗外：焦點放回去，捲到下緣貼視窗底邊', () => {
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 720 });
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);
    try {
      const { opener, cancel } = openDialog();
      opener.getBoundingClientRect = () => ({ top: 800, bottom: 840, height: 40 }) as DOMRect;
      const focus = vi.spyOn(opener, 'focus');
      fireEvent.click(cancel);
      expect(opener).toHaveFocus();
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
      expect(scrollBy).toHaveBeenCalledExactlyOnceWith(0, 120);
    } finally {
      vi.unstubAllGlobals();
      Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 0 });
    }
  });

  it('點背景取消，點內容不關', () => {
    const { dialog } = openDialog();
    fireEvent.click(screen.getByText('不能復原'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(dialog);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('關閉之後不再聽 Esc', () => {
    const onCancel = vi.fn();
    const { unmount } = render(
      <ConfirmDialog title="清除？" confirmLabel="確定" onCancel={onCancel} onConfirm={() => {}}>
        內容
      </ConfirmDialog>
    );
    unmount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('說明', () => {
  it('內文是對話框的 accessible description：螢幕閱讀器打開時念標題也念內容，不只念標題與取消', () => {
    const { dialog } = openDialog();
    expect(dialog).toHaveAccessibleName('清除？');
    expect(dialog).toHaveAccessibleDescription('不能復原');
  });
});
