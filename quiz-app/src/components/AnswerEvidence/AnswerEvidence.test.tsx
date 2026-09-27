// 「答案依據」標題本身就是一種承諾：一手來源才敢這樣叫。
import { describe, it, expect } from 'vitest';
import { render, screen, isInaccessible } from '@testing-library/react';
import { AnswerEvidence } from './AnswerEvidence';

const primary = {
  quote: 'emissions from mobile machinery for transportation purposes shall be excluded.',
  url: 'https://eur-lex.europa.eu/legal-content/en/TXT/?uri=CELEX%3A32025R2547',
};

describe('AnswerEvidence', () => {
  it('一手來源標「答案依據」，並附可追溯的連結', () => {
    render(<AnswerEvidence evidence={primary} />);
    expect(screen.getByLabelText('答案依據')).toBeInTheDocument();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', primary.url);
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByText('次級來源')).not.toBeInTheDocument();
  });

  it('次級來源降級成「參考引文」，不承諾它證明了正解', () => {
    render(<AnswerEvidence evidence={{ ...primary, authority: 'secondary' }} />);
    expect(screen.getByLabelText('參考引文')).toBeInTheDocument();
    expect(screen.queryByLabelText('答案依據')).not.toBeInTheDocument();
    expect(screen.getByText('次級來源')).toBeInTheDocument();
  });

  it('沒有引文就不渲染任何東西', () => {
    const { container } = render(<AnswerEvidence />);
    expect(container).toBeEmptyDOMElement();
  });

  // 官方公告試題的依據是官方 PDF 上的這一題與它的答案欄；引文只印得出題目本身，
  // 框裡要另外寫出答案欄印的是哪一個、題目在 PDF 的哪裡，否則整個框沒有一句說出答案。
  const official = {
    ...primary,
    official: { answer: 'C', reference: '115 年第一次公告試題第一科第 1 題' },
  };

  it('依據是官方公告試題本身時，寫出官方公告的參考答案與題目出處（哪一場、哪一科、第幾題）', () => {
    render(<AnswerEvidence evidence={official} />);
    // getByText 找得到被 hidden／aria-hidden 藏起來的元素：這一行是框裡唯一說出答案的句子，要問無障礙樹
    expect(
      isInaccessible(
        screen.getByText('官方公告的參考答案：(C)（115 年第一次公告試題第一科第 1 題）')
      )
    ).toBe(false);
  });

  it('結果頁的精簡框一樣寫出官方答案', () => {
    render(<AnswerEvidence evidence={official} compact />);
    expect(
      isInaccessible(
        screen.getByText('官方公告的參考答案：(C)（115 年第一次公告試題第一科第 1 題）')
      )
    ).toBe(false);
  });

  it('其他引文不寫官方答案', () => {
    render(<AnswerEvidence evidence={primary} />);
    expect(screen.queryByText(/官方公告的參考答案/)).not.toBeInTheDocument();
  });
});
