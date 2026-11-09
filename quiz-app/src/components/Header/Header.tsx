// Header 元件 - 頂部導覽列
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { useAccessibility } from '../../hooks/useAccessibility';
import { DISCUSSIONS_URL, REPORT_URL } from '../../utils/feedback-url';
import './Header.css';

interface HeaderProps {
  onOpenSettings: () => void;
  onGoHome: () => void;
  accessibility: ReturnType<typeof useAccessibility>;
}

/** 會移動焦點的按鍵：Tab（含 Shift+Tab）、radio 之間的方向鍵 */
const FOCUS_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export function Header({ onOpenSettings, onGoHome, accessibility }: HeaderProps) {
  const { settings, toggleDarkMode } = accessibility;
  const headerRef = useRef<HTMLElement>(null);

  // header 固定在上面，高度跟著字級與寬度變（64px 到將近 80px）。捲到題幹、選項時要停在它下面，
  // 鍵盤提示也貼在它下面：量出來放進 --app-header-height，不寫死 64px（QuestionCard.css、App.css）
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      if (height > 0) document.documentElement.style.setProperty('--app-header-height', `${height}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);

  // html 的 scroll-padding-top 讓 Tab、Shift+Tab 捲到的地方停在頁首下面（App.css）。Firefox 只在焦點不完全在視窗裡時才捲，
  // 判斷時不扣 scroll-padding：一半在頁首底下的控制項不會捲出來。用鍵盤移動焦點時補捲一次。
  // 視窗底邊也一樣：Firefox 與 WebKit 往下 Tab 時，一部分在視窗下面的控制項有時不捲（main 上就有，差 2 到 36px）
  // 對話框不管：它們蓋在頁首上面、自己捲動（多半是 role="dialog" 的 div，不是 <dialog>），scroll-padding-top 跟它們無關
  // 只補捲按鍵移過去的焦點（Tab、Shift+Tab、方向鍵在 radio 之間）：瀏覽器在 keydown 的同一個 task 裡移動焦點。
  // 程式呼叫的 focus（別的分頁改了名單時 RemoveFromReview 用 preventScroll 把焦點放回那一列）、視窗拿回焦點時瀏覽器
  // 把焦點還給原來的元素，都不是使用者移動焦點，頁面不能捲。加 Ctrl、Alt、Meta 的是切換瀏覽器分頁或視窗
  // 補捲排在下一個 frame。下一個按鍵或按下指標之前還沒跑到的就不跑：那時候頁面可能已經被別的東西捲過，
  // 例如按星號存不進去時捲出來的說明（ReviewNotice.tsx）。沒有新的畫面要畫時 WebKit 會把 frame 延後，
  // 實測 focus() 之後 200ms 才跑，把已經捲出來的說明又捲回視窗外
  useEffect(() => {
    let frame = 0;
    let keyMove = false;
    const onKeyDown = (e: KeyboardEvent) => {
      cancelAnimationFrame(frame);
      keyMove = FOCUS_KEYS.has(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey;
      if (keyMove) setTimeout(() => (keyMove = false));
    };
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (!keyMove || !(target instanceof Element)) return;
      if (target.closest('.app-header, dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]')) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (document.activeElement !== target || !target.matches(':focus-visible')) return;
        // 藏起來的 radio、checkbox 沒有大小，看得到的是外面的 label
        const shown = target.getBoundingClientRect().height > 0 ? target : (target.closest('label') ?? target);
        const limit = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
        const box = shown.getBoundingClientRect();
        const below = box.bottom > document.documentElement.clientHeight + 1;
        if (box.top < limit - 1 || below) shown.scrollIntoView({ block: 'nearest' });
      });
    };
    const cancel = () => cancelAnimationFrame(frame);
    document.addEventListener('focusin', onFocusIn);
    // capture：Tab 的 keydown 在焦點移動（focusin）之前，取消的是上一次的，不是這一次的；頁面上的元素攔下來也聽得到
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', cancel, true);
    return () => {
      cancel();
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', cancel, true);
    };
  }, []);

  return (
    <header className="app-header" ref={headerRef}>
      <div className="header-container">
        {/* Logo / 標題 */}
        <button className="header-logo" onClick={onGoHome} aria-label="回首頁">
          <span className="material-icons lg">eco</span>
          <div className="logo-text">
            <span className="logo-title">淨零碳備考神器</span>
            <span className="logo-subtitle">iPAS 考古題練習</span>
          </div>
        </button>

        {/* 功能按鈕 */}
        <nav className="header-actions" aria-label="功能選單">
          {/* 深色模式切換 */}
          <button
            className="btn btn-text icon-btn"
            onClick={toggleDarkMode}
            aria-label={settings.darkMode ? '切換淺色模式' : '切換深色模式'}
            title={settings.darkMode ? '淺色模式' : '深色模式'}
          >
            <span className="material-icons">
              {settings.darkMode ? 'light_mode' : 'dark_mode'}
            </span>
          </button>

          {/* 設定 */}
          <button
            className="btn btn-text icon-btn"
            onClick={onOpenSettings}
            aria-label="開啟設定"
            title="設定"
          >
            <span className="material-icons">settings</span>
          </button>

          {/* 回報問題（GitHub issue）與討論區（GitHub Discussions）分開；寬螢幕顯示字，窄螢幕只留圖示 */}
          <a
            href={REPORT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-text icon-btn header-link"
            aria-label="回報問題"
            title="回報問題"
          >
            <span className="material-icons" aria-hidden="true">bug_report</span>
            <span className="header-link-text">回報問題</span>
          </a>
          <a
            href={DISCUSSIONS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-text icon-btn header-link"
            aria-label="討論區"
            title="討論區"
          >
            <span className="material-icons" aria-hidden="true">forum</span>
            <span className="header-link-text">討論區</span>
          </a>
        </nav>
      </div>
    </header>
  );
}

export default Header;
