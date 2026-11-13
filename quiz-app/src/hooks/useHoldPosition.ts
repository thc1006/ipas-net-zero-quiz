// 使用者換了一個控制項（首頁的題目來源、考科範圍、題數、加強練習池的開關，設定頁的字級），它上面的內容跟著長高或變矮：
// 控制項被推下去（Pixel 7 字級特大時題目來源被推到視窗底邊下面）或拉上來（WebKit 拉到頁首底下）。
// scroll anchoring 只在錨點排在變動的內容下面時才補，錨點在說明卡裡、捲在最上面時都不補。
// 換的當下記下控制項的位置，畫出來之前把頁面捲回去，正在操作的控制項不移動。捲在最上面時往上的捲不回去，只能捲到 0
import { useCallback, useLayoutEffect, useRef } from 'react';
import { revealBelowHeader } from '../utils/reveal-focus';

interface Held {
  el: Element;
  top: number;
  reveal: boolean;
}

/** 使用者自己捲動或按鍵：之後的補捲作廢 */
const USER_INPUT = ['wheel', 'touchmove', 'keydown', 'pointerdown'];

/**
 * 回傳 hold(el, reveal)：在改 state 的事件裡呼叫，這個元件下一次畫完（layout effect，還沒畫到畫面上）時把 el 捲回原來的位置。
 * reveal（沒給就用 hook 的）：之後再捲到頁首下面、視窗之內（設定頁換字級時頁首自己也變高，原來的位置可能在頁首底下；首頁的
 * 開關換了樣式自己變高，在視窗底邊的話下緣超出）。只在需要的地方開：首頁換題目來源時也開的話，WebKit 之後在題目頁按上一題，
 * scroll anchoring 不補、上一題被推到視窗外（round 12 的 probe-k，只出官方題目那一段；原因沒查清楚，不開就恢復）。
 * 要排在會改高度的 layout effect（useKeepHeight）後面：它們先改好 min-height 再量
 */
export function useHoldPosition(reveal = false): (el: Element | null | undefined, reveal?: boolean) => void {
  const held = useRef<Held | null>(null);
  // 每記一次加一：等 transition 的補捲只做最後一次的
  const round = useRef(0);

  useLayoutEffect(() => {
    const h = held.current;
    if (!h) return;
    held.current = null;
    // 捲動量取整數：WebKit 的捲動位置只留整數，小數在畫出來時捨去，差 0.8 的捲動一次都沒捲到，一路換下去就一路往同一邊
    // 偏（Pixel 7 字級特大用方向鍵換題目來源，換到後來超出視窗底邊）。四捨五入各引擎都一樣，誤差在 0.5 以內、有正有負。
    // 被頁首蓋到或超出視窗底邊、捲出來之後，之後的 frame 留在捲出來的位置：不然每個 frame 先捲回去再捲出來，來回跳
    const settle = () => {
      if (!h.el.isConnected) return;
      const by = Math.round(h.el.getBoundingClientRect().top - h.top);
      if (by !== 0) window.scrollBy(0, by);
      // 捲出來的距離從記下的位置扣掉，不再量一次版面：在這裡多量一次時，WebKit 之後在題目頁按上一題，scroll anchoring
      // 不補、上一題被推到視窗外（round 12 的 probe-k，原因沒查清楚，拿掉這一次量就恢復）
      if (h.reveal) h.top -= revealBelowHeader(h.el);
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

  return useCallback(
    (el, show = reveal) => {
      if (!el) return;
      round.current++;
      const h = { el, top: el.getBoundingClientRect().top, reveal: show };
      held.current = h;
      // 這一次沒有重畫（值沒變）的話不留到之後別的原因重畫（別的分頁改了名單）才捲
      setTimeout(() => {
        if (held.current === h) held.current = null;
      });
    },
    [reveal]
  );
}
