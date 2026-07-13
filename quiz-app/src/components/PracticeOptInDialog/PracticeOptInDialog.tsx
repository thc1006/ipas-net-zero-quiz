// 加強練習池 opt-in 對話框：首次啟用時揭露 AI 產題與第三方模擬題之來源
// 對應 EU AI Act Art.50（2026-08-02 起）對 AI 生成文字之揭露義務
import { useEffect, useRef } from 'react';
import { PRACTICE_POOL_COUNTS } from '../../data/practice-pool-counts';
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

    // 註：故意不設 aria-hidden 於 #root —— dialog 自己已有 aria-modal="true"，
    // 螢幕閱讀器會把 modal 外的內容視為 inert。若再設 root 的 aria-hidden，
    // dialog 本身（render 在 root 內）也會被誤判為隱藏，導致 a11y tree 找不到 dialog。

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
          加強練習池是<strong>獨立於主題庫的補充題目</strong>，總計 {PRACTICE_POOL_COUNTS.total} 題。題目來自兩種來源：
        </p>
        <ul>
          <li>
            <strong>模擬題（{PRACTICE_POOL_COUNTS.externalMock} 題）</strong>：公開模擬題（非官方歷屆，iPAS 不公開歷屆）。
          </li>
          <li>
            <strong>AI 產題（{PRACTICE_POOL_COUNTS.aiGenerated} 題）</strong>：由語言模型依環境部、CBAM、ISO 等
            法規與標準產生，每題附一手來源連結。
          </li>
        </ul>
        <p className="optin-note">
          <strong>老實說：這些題目有多可信。</strong>
        </p>
        <ul className="optin-note">
          <li>
            <strong>機器擋得住的</strong>：解析中「」括起來、宣稱是法條原文的句子，CI 會逐字比對
            全國法規資料庫的條文 —— 捏造的條文會被擋下來。數值題的答案也逐題經人工手算或查證出處。
          </li>
          <li>
            <strong>機器擋不住的</strong>：「條號有沒有掛錯」「有沒有捏造出一部不存在的法規」——
            這些我們<strong>確實抓到過</strong>（曾把碳費公式掛在錯的條號上、捏造過一部不存在的辦法）。
            連結是活的不代表指對地方。
          </li>
        </ul>
        <p className="optin-note">
          每題皆顯示來源徽章。<strong>請以法規原文與官方教材為最終依據。</strong>
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
