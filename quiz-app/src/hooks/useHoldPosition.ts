// 使用者換了一個控制項（首頁的題目來源、考科範圍、題數、加強練習池的開關，設定頁的字級），它上面的內容跟著長高或變矮：
// 控制項被推下去（Pixel 7 字級特大時題目來源被推到視窗底邊下面）或拉上來（WebKit 拉到頁首底下）。
// scroll anchoring 只在錨點排在變動的內容下面時才補，錨點在說明卡裡、捲在最上面時都不補。
// 換的當下記下控制項的位置，畫出來之前把頁面捲回去，正在操作的控制項不移動。捲在最上面時往上的捲不回去，只能捲到 0
import { useCallback, useLayoutEffect, useRef } from 'react';
import { revealBelowHeader } from '../utils/reveal-focus';

interface Held {
  el: Element;
  top: number;
}

/** 使用者自己捲動或按鍵：之後的補捲作廢 */
const USER_INPUT = ['wheel', 'touchmove', 'keydown', 'pointerdown'];

/**
 * 回傳 hold(el)：在改 state 的事件裡呼叫，這個元件下一次畫完（layout effect，還沒畫到畫面上）時把 el 捲回原來的位置。
 * reveal：之後再捲到頁首下面、視窗之內（設定頁換字級時頁首自己也變高，原來的位置可能在頁首底下）。
 * 要排在會改高度的 layout effect（useKeepHeight）後面：它們先改好 min-height 再量
 */
export function useHoldPosition(reveal = false): (el: Element | null | undefined) => void {
  const held = useRef<Held | null>(null);
  // 每記一次加一：等 transition 的補捲只做最後一次的
  const round = useRef(0);

  useLayoutEffect(() => {
    const h = held.current;
    if (!h) return;
    held.current = null;
    const settle = () => {
      if (!h.el.isConnected) return;
      const by = h.el.getBoundingClientRect().top - h.top;
      if (by !== 0) window.scrollBy(0, by);
      if (reveal) revealBelowHeader(h.el);
    };
    settle();
    // 上面的按鈕（.btn 的 transition: all）換字級時字與 padding 慢慢變，上面的內容在這 0.2 秒裡一直換高度，Firefox 的
    // 捲動位置沒跟著補（1280x720 選單移動 6.8px，跑完還差 1px）。跑完之前每個 frame 捲一次，跑完再捲一次；
    // 中間使用者自己捲了、按了鍵，或又換了一次，就不捲
    const running = 'getAnimations' in document ? document.getAnimations().filter((a) => 'transitionProperty' in a) : [];
    if (running.length === 0) return;
    const mine = round.current;
    const cancel = () => {
      if (round.current === mine) round.current++;
    };
    for (const type of USER_INPUT) window.addEventListener(type, cancel, { capture: true, once: true });
    let frame = requestAnimationFrame(function follow() {
      if (round.current !== mine) return;
      settle();
      frame = requestAnimationFrame(follow);
    });
    void Promise.allSettled(running.map((a) => a.finished)).then(() => {
      cancelAnimationFrame(frame);
      for (const type of USER_INPUT) window.removeEventListener(type, cancel, { capture: true });
      if (round.current === mine) settle();
    });
  });

  return useCallback((el) => {
    if (!el) return;
    round.current++;
    const h = { el, top: el.getBoundingClientRect().top };
    held.current = h;
    // 這一次沒有重畫（值沒變）的話不留到之後別的原因重畫（別的分頁改了名單）才捲
    setTimeout(() => {
      if (held.current === h) held.current = null;
    });
  }, []);
}
