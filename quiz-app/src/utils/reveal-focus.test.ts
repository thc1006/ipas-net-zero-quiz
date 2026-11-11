import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { returnFocus, revealBelowHeader } from './reveal-focus';

// jsdom 不排版：頁首、元素的位置與視窗高度都用假的。頁首 64px、視窗 720px
const rect = (top: number, height: number) => ({ top, bottom: top + height, height }) as DOMRect;

describe('returnFocus：程式放回焦點之後捲最少的距離', () => {
  let header: HTMLElement;
  let button: HTMLButtonElement;
  let scrollBy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    header = document.createElement('header');
    header.className = 'app-header';
    header.getBoundingClientRect = () => rect(0, 64);
    button = document.createElement('button');
    document.body.append(header, button);
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 720 });
    scrollBy = vi.fn();
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('在視窗底邊下面：下緣捲到視窗底邊（小數往上取整），focus 自己不捲', () => {
    button.getBoundingClientRect = () => rect(810.3, 40);
    const focus = vi.spyOn(button, 'focus');
    returnFocus(button);
    expect(document.activeElement).toBe(button);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scrollBy).toHaveBeenCalledWith(0, 131);
  });

  it('在頁首底下：上緣捲到頁首下緣（小數往下取整）', () => {
    button.getBoundingClientRect = () => rect(20.5, 40);
    returnFocus(button);
    expect(scrollBy).toHaveBeenCalledWith(0, -44);
  });

  it('比可用的高度高：上緣貼頁首，不捲到下緣', () => {
    button.getBoundingClientRect = () => rect(600, 900);
    returnFocus(button);
    expect(scrollBy).toHaveBeenCalledWith(0, 536);
  });

  it('看得到：不捲（剛好貼著頁首與視窗底邊也不捲）', () => {
    button.getBoundingClientRect = () => rect(64, 656);
    returnFocus(button);
    expect(document.activeElement).toBe(button);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('頁首裡的按鈕不捲', () => {
    const inHeader = document.createElement('button');
    header.append(inHeader);
    inHeader.getBoundingClientRect = () => rect(10, 40);
    returnFocus(inHeader);
    expect(document.activeElement).toBe(inHeader);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('不在畫面上、是 body、拿不到焦點（disabled）：焦點不動也不捲', () => {
    const gone = document.createElement('button');
    gone.getBoundingClientRect = () => rect(900, 40);
    returnFocus(gone);
    returnFocus(null);
    returnFocus(document.body);
    button.disabled = true;
    button.getBoundingClientRect = () => rect(900, 40);
    returnFocus(button);
    expect(document.activeElement).toBe(document.body);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('藏起來的 radio（沒有大小）看外面的 label', () => {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    label.append(radio);
    document.body.append(label);
    radio.getBoundingClientRect = () => rect(0, 0);
    label.getBoundingClientRect = () => rect(700, 68);
    revealBelowHeader(radio);
    expect(scrollBy).toHaveBeenCalledWith(0, 48);
  });

  it('沒有頁首（測試裡單獨畫的元件）：只看視窗', () => {
    header.remove();
    button.getBoundingClientRect = () => rect(-30, 40);
    returnFocus(button);
    expect(scrollBy).toHaveBeenCalledWith(0, -30);
  });
});
