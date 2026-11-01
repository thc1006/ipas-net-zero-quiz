// Header：回報問題（GitHub issue）與討論區（GitHub Discussions）是兩個分開、各自有名稱的入口
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { Header } from './Header';
import { useAccessibility } from '../../hooks/useAccessibility';
import { DISCUSSIONS_URL, REPORT_URL } from '../../utils/feedback-url';

afterEach(cleanup);

function HeaderHarness() {
  const accessibility = useAccessibility();
  return <Header accessibility={accessibility} onOpenSettings={() => {}} onGoHome={() => {}} />;
}

describe('Header 的回報問題與討論區', () => {
  it('功能選單裡有兩個連結：回報問題開 issue 範本選單，討論區開 Discussions', () => {
    render(<HeaderHarness />);
    const nav = screen.getByRole('navigation', { name: '功能選單' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => [link.getAttribute('aria-label'), link.getAttribute('href')])).toEqual([
      ['回報問題', REPORT_URL],
      ['討論區', DISCUSSIONS_URL],
    ]);
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      // 名稱跟畫面上的字一樣（寬螢幕顯示字，窄螢幕只剩圖示）
      expect(link).toHaveTextContent(link.getAttribute('aria-label')!);
      expect(link).toHaveAttribute('title', link.getAttribute('aria-label'));
      // 圖示不唸出來
      for (const icon of link.querySelectorAll('.material-icons, svg')) {
        expect(icon).toHaveAttribute('aria-hidden', 'true');
      }
    }
  });

  it('依名稱找得到兩個入口，沒有合在一起的舊入口', () => {
    render(<HeaderHarness />);
    expect(screen.getByRole('link', { name: '回報問題' })).toHaveAttribute('href', REPORT_URL);
    expect(screen.getByRole('link', { name: '討論區' })).toHaveAttribute('href', DISCUSSIONS_URL);
    expect(screen.queryByRole('link', { name: /社群討論|回報題目/ })).toBeNull();
  });

  it('既有的按鈕不受影響', () => {
    render(<HeaderHarness />);
    expect(screen.getByRole('button', { name: '回首頁' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '開啟設定' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /切換(深色|淺色)模式/ })).toBeInTheDocument();
  });
});
