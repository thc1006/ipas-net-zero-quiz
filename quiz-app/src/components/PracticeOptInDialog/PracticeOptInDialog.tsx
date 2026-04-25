// 加強練習池 opt-in 對話框：首次啟用時揭露 AI 產題與第三方模擬題之來源
// 對應 EU AI Act Art.50（2026-08-02 起）對 AI 生成文字之揭露義務
import { useEffect, useRef } from 'react';
import './PracticeOptInDialog.css';

interface PracticeOptInDialogProps {
  open: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function PracticeOptInDialog({ open, onAccept, onDecline }: PracticeOptInDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus into the first focusable element inside dialog
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    focusables?.[0]?.focus();

    // aria-hide everything OUTSIDE the dialog so SR not reading both
    const root = document.getElementById('root');
    const prevAriaHidden = root?.getAttribute('aria-hidden') ?? null;
    root?.setAttribute('aria-hidden', 'true');

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDecline();
        return;
      }
      if (e.key !== 'Tab') return;
      // Simple focus trap
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!nodes || nodes.length === 0) return;
      const f = nodes[0];
      const l = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === f) {
        e.preventDefault();
        l.focus();
      } else if (!e.shiftKey && document.activeElement === l) {
        e.preventDefault();
        f.focus();
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      if (prevAriaHidden === null) root?.removeAttribute('aria-hidden');
      else root?.setAttribute('aria-hidden', prevAriaHidden);
      previouslyFocused?.focus?.();
    };
  }, [open, onDecline]);

  if (!open) return null;
  return (
    <div
      className="optin-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="optin-title"
      aria-describedby="optin-desc"
      onClick={(e) => {
        // 點擊 overlay 外圍視為 decline（保留 dialog 內點擊）
        if (e.target === e.currentTarget) onDecline();
      }}
    >
      <div className="optin-dialog" ref={dialogRef} tabIndex={-1}>
        <h2 id="optin-title">啟用加強練習池</h2>
        <p id="optin-desc">
          加強練習池是<strong>獨立於主題庫的補充題目</strong>，總計 143 題。題目來自兩種來源：
        </p>
        <ul>
          <li>
            <strong>模擬題（54 題）</strong>：取自 vocus 講師、HackMD、yamol 等公開模擬題，
            非官方歷屆試題（iPAS 不公開歷屆）。
          </li>
          <li>
            <strong>AI 產題（89 題）</strong>：由語言模型依環境部、CBAM、ISO 等法規與標準
            產生，並經獨立驗證代理逐題以權威來源（law.moj.gov.tw、EUR-Lex、IPCC、ISO 等）
            交叉比對通過。
          </li>
        </ul>
        <p className="optin-note">
          每題皆顯示來源徽章。AI 產題答案雖經驗證，仍以官方教材為最終依據。
          本揭露依 EU AI Act Art. 50（2026-08-02 起對 AI 生成文字強制揭露）。
        </p>
        <div className="optin-actions">
          <button className="btn btn-secondary" onClick={onDecline}>
            暫不啟用
          </button>
          <button className="btn btn-primary" onClick={onAccept}>
            我已了解，啟用加強練習
          </button>
        </div>
      </div>
    </div>
  );
}

export default PracticeOptInDialog;
