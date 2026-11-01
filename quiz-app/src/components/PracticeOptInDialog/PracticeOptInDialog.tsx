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

    // 焦點進第一顆按鈕，不是排在前面的內文捲動區：先按得到按鈕，要捲內文再 Shift+Tab。
    // 不讓 focus() 自己捲：樣式表還沒載完（Google Fonts 慢）時 WebKit 照沒有樣式的版面捲，捲的是後面的頁面。
    // 改成畫第一個畫面前（requestAnimationFrame）自己把對話框捲到底，對話框比視窗高（放大 400%）時按鈕才進得來。
    // 樣式表到之前頁面不會畫，所以這時樣式一定已經套上。不等 load：load 也等字型檔，下載期間按鈕都在畫面外
    const dialog = dialogRef.current!;
    dialog.querySelector('button')!.focus({ preventScroll: true });
    const frame = requestAnimationFrame(() => {
      dialog.scrollTop = dialog.scrollHeight;
    });

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
      // 焦點陷阱。listener 只在對話框開著時掛著，ref 一定在；裡面一定有內文捲動區與兩顆按鈕
      const nodes = [...dialogRef.current!.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
      const f = nodes[0];
      const l = nodes[nodes.length - 1];
      const active = document.activeElement;
      // 點對話框空白處時焦點在對話框本身（tabIndex -1）或 body，不在 nodes 裡，也要接回來
      const outside = !nodes.includes(active as HTMLElement);
      if (e.shiftKey && (active === f || outside)) {
        e.preventDefault();
        l.focus();
      } else if (!e.shiftKey && (active === l || outside)) {
        e.preventDefault();
        f.focus();
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      cancelAnimationFrame(frame);
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
        {/* 小視窗上只有這裡捲動，標題與按鈕留在畫面內。tabIndex：WebKit 的捲動區鍵盤到不了 */}
        <div className="optin-body" role="group" aria-labelledby="optin-title" tabIndex={0}>
          <p id="optin-desc">
            加強練習池是<strong>獨立於主題庫的補充題目</strong>，總計 {PRACTICE_POOL_COUNTS.total} 題。題目來自兩種來源：
          </p>
          <ul>
            <li>
              <strong>模擬題（{PRACTICE_POOL_COUNTS.externalMock} 題）</strong>：公開模擬題（非官方試題）。
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
        </div>
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
