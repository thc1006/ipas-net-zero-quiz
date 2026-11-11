// 設定頁的確認對話框（樣式在 SettingsPage.css）。動作都不能復原，所以預設焦點在取消：
// 連按兩下 Enter 不會誤清。aria-modal 要名符其實：Tab 出不去，關閉後焦點回到打開它的按鈕。
// 內文接到 aria-describedby：焦點直接落在取消，沒有它的話螢幕閱讀器只念標題與「取消」，題數與警告都聽不到。
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { returnFocus } from '../../utils/reveal-focus';

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    // 開著時後面的頁面照樣捲得動（滾輪、觸控）：打開它的按鈕可能已經在視窗外
    return () => returnFocus(opener);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key !== 'Tab') return;
      const active = document.activeElement;
      if (!dialogRef.current?.contains(active)) {
        e.preventDefault();
        cancelRef.current?.focus();
      } else if (e.shiftKey && active === cancelRef.current) {
        e.preventDefault();
        confirmRef.current?.focus();
      } else if (!e.shiftKey && active === confirmRef.current) {
        e.preventDefault();
        cancelRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      ref={dialogRef}
      className="settings-confirm-dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onClick={onCancel}
    >
      <div className="settings-confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 id={titleId}>{title}</h2>
        <p id={bodyId}>{children}</p>
        <div className="settings-confirm-dialog__actions">
          <button ref={cancelRef} type="button" className="btn btn-secondary" onClick={onCancel}>
            取消
          </button>
          <button ref={confirmRef} type="button" className="btn btn-primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
