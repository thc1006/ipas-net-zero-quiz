// 「答案依據」標題本身就是一種承諾：一手來源才敢這樣叫。
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
