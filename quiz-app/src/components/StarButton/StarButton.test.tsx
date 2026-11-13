// 星號按鈕：aria-pressed 表達狀態，名稱固定；實心與空心圖示讓狀態不只靠顏色
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StarButton } from './StarButton';
import { __resetReviewStoreForTesting, getReviewSnapshot, isStarred } from '../../utils/review-storage';
import { installRealLocalStorage } from '../../utils/__fixtures__/real-local-storage';

beforeEach(() => {
  installRealLocalStorage();
  __resetReviewStoreForTesting();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const button = () => screen.getByRole('button', { name: '加星號' });
const star = () => button().querySelector('svg path')!;

describe('StarButton', () => {
  it('type=button（表單裡不會送出）、名稱固定、按下去切換 aria-pressed', () => {
    render(<StarButton questionId="q1" />);
    expect(button()).toHaveAttribute('type', 'button');
    expect(button()).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button());
    expect(button()).toHaveAttribute('aria-pressed', 'true');
    expect(isStarred(getReviewSnapshot(), 'q1')).toBe(true);
    fireEvent.click(button());
    expect(button()).toHaveAttribute('aria-pressed', 'false');
    expect(isStarred(getReviewSnapshot(), 'q1')).toBe(false);
  });

  it('實心與空心不只靠顏色；圖示不念出來；用 SVG，圖示字型被擋時不會變成一串文字', () => {
    render(<StarButton questionId="q1" />);
    expect(star()).toHaveAttribute('fill', 'none');
    expect(button().querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(button().textContent).toBe('');
    expect(button().querySelector('.material-icons')).toBeNull();
    fireEvent.click(button());
    expect(star()).toHaveAttribute('fill', 'currentColor');
  });

  it('可以指定名稱（結果頁有好幾顆星號，要分得出題目）；名稱不隨狀態變', () => {
    render(<StarButton questionId="q1" label="第 3 題加星號" />);
    const b = screen.getByRole('button', { name: '第 3 題加星號' });
    fireEvent.click(b);
    expect(b).toHaveAttribute('aria-pressed', 'true');
    expect(b).toHaveAttribute('aria-label', '第 3 題加星號');
  });

  it('寫入失敗時維持原狀：畫面不能說存了', () => {
    render(<StarButton questionId="q1" />);
    localStorage.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    fireEvent.click(button());
    expect(button()).toHaveAttribute('aria-pressed', 'false');
  });

  it('同一題兩顆按鈕同步（題卡與結果頁的訂閱都走 store）', () => {
    render(
      <>
        <StarButton questionId="q1" />
        <StarButton questionId="q1" />
      </>
    );
    const [a, b] = screen.getAllByRole('button', { name: '加星號' });
    fireEvent.click(a);
    expect(b).toHaveAttribute('aria-pressed', 'true');
  });
});
