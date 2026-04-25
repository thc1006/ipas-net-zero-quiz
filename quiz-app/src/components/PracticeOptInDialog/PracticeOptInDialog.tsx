// 加強練習池 opt-in 對話框 — Carbon Ledger 友善版
// 設計：兩欄佈局；左欄視覺敘事（兩種來源視覺化條形）、右欄文字解說與 CTA。
// 對應 EU AI Act Art.50（2026-08-02 起）對 AI 生成文字之揭露義務。
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

  // 條形比例：54:89 為實際數字
  const mockPct = (54 / 143) * 100;
  const aiPct = (89 / 143) * 100;

  return (
    <div
      className="optin-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="optin-title"
      aria-describedby="optin-desc"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDecline();
      }}
    >
      <div className="optin-dialog" ref={dialogRef} tabIndex={-1}>
        <header className="optin-dialog__head">
          <span className="cl-eyebrow">Addendum / 加強練習池</span>
          <h2 id="optin-title" className="cl-display optin-dialog__title">
            啟用加強練習池
          </h2>
          <p className="optin-dialog__sub">加進來，可以嗎？</p>
        </header>

        <div className="optin-dialog__body">
          {/* 左欄：視覺化來源 */}
          <aside className="optin-source-panel" aria-hidden="true">
            <div className="optin-source-stack">
              <div className="optin-source-row">
                <div className="optin-source-row__head">
                  <span className="optin-source-row__label">
                    <span className="optin-source-row__dot tone-mock" />
                    模擬題
                  </span>
                  <span className="cl-figure optin-source-row__count">54</span>
                </div>
                <div
                  className="optin-source-bar"
                  style={{ width: `${mockPct}%` }}
                />
                <div className="optin-source-row__caption">vocus 講師、HackMD、yamol</div>
              </div>

              <div className="optin-source-row">
                <div className="optin-source-row__head">
                  <span className="optin-source-row__label">
                    <span className="optin-source-row__dot tone-ai" />
                    AI 產題
                  </span>
                  <span className="cl-figure optin-source-row__count">89</span>
                </div>
                <div
                  className="optin-source-bar tone-ai"
                  style={{ width: `${aiPct}%` }}
                />
                <div className="optin-source-row__caption">由獨立驗證代理 cross-check</div>
              </div>

              <div className="optin-source-total">
                <span className="cl-eyebrow">total addendum</span>
                <span className="cl-figure optin-source-total__num">143</span>
              </div>
            </div>
          </aside>

          {/* 右欄：文字 */}
          <div className="optin-dialog__copy">
            <p id="optin-desc" className="optin-dialog__lead">
              這是一份<em>獨立於主題庫</em>的補充題庫。
              啟用後，下一場練習的抽題範圍會混入這 143 題，每一題都會帶來源徽章——
              你隨時看得出眼前這題出自哪裡。
            </p>

            <ol className="optin-bullets">
              <li>
                <span className="cl-fn-marker">1</span>
                <div>
                  <strong>模擬題</strong>取自公開講師整理（vocus / HackMD / yamol 等）；
                  iPAS 不公開歷屆試題，這是<em>非官方</em>的最佳替代。
                </div>
              </li>
              <li>
                <span className="cl-fn-marker">2</span>
                <div>
                  <strong>AI 產題</strong>由語言模型基於環境部、CBAM Reg、ISO 14064/14067、IPCC 等法規與標準
                  產生，每題經獨立驗證代理逐條對照<span className="cl-figure">law.moj.gov.tw</span>、
                  <span className="cl-figure">EUR-Lex</span>、<span className="cl-figure">IPCC</span>、<span className="cl-figure">ISO</span>。
                </div>
              </li>
              <li>
                <span className="cl-fn-marker">3</span>
                <div>
                  <strong>仍以官方教材為最終依據。</strong>
                  AI 產題不可能保證 100% 正確；用來補強，不取代你手邊的講義。
                </div>
              </li>
            </ol>

            <p className="optin-disclosure">
              <span className="material-icons sm">verified_user</span>
              <span>
                揭露依 <span className="cl-figure">EU AI Act Art. 50</span>（2026-08-02 對 AI 生成文字強制揭露生效）
              </span>
            </p>
          </div>
        </div>

        <footer className="optin-actions">
          <button className="btn btn-secondary cl-btn-secondary" onClick={onDecline}>
            暫不啟用
          </button>
          <button className="btn btn-primary cl-btn-primary" onClick={onAccept}>
            我已了解，啟用加強練習
            <span className="material-icons cl-btn-primary__arrow">arrow_forward</span>
          </button>
        </footer>
      </div>
    </div>
  );
}

export default PracticeOptInDialog;
