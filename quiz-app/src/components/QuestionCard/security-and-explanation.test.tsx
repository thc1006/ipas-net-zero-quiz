// 兩件會安靜出事的事情：
// 1. AI 回覆是第三方輸入，卻被丟進 dangerouslySetInnerHTML —— 沒有逸出就是 DOM XSS。
// 2. 918 則人工解析躺在資料裡從不顯示，畫面上只有一顆 AI 按鈕，
//    等於讓未經審核的生成內容取代已審核的內容。
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuestionCard, renderMarkdown } from './QuestionCard';
import type { QuizQuestion } from '../../types/quiz';

const base: QuizQuestion = {
  id: 'sec-1',
  stem: '測試題幹',
  options: [
    { key: 'A', text: '甲' },
    { key: 'B', text: '乙' },
    { key: 'C', text: '丙' },
    { key: 'D', text: '丁' },
  ],
  answer: 'A',
  subject: '考科1',
  sourceType: 'gist',
  year: null,
  hasAnswer: true,
};

describe('AI 輸出不得注入 HTML', () => {
  it.each([
    '<img src=x onerror="window.__xss = 1">',
    '<script>window.__xss = 1</script>',
    '<a href="javascript:alert(1)">click</a>',
    '<div onclick="alert(1)">x</div>',
  ])('逸出惡意輸入：%s', (payload) => {
    const html = renderMarkdown(payload);
    // 重點不是字串裡有沒有 onerror 這幾個字（逸出後它只是文字），
    // 而是 `<` 已被逸出、永遠組不成標籤，因此瀏覽器不會建立任何節點。
    expect(html).toContain('&lt;');

    const host = document.createElement('div');
    host.innerHTML = html;
    expect(host.querySelector('img, script, a, div[onclick]')).toBeNull();
    expect(host.textContent).toContain('<');
  });

  it('逸出後仍保留 markdown 粗體/程式碼功能', () => {
    const html = renderMarkdown('**重點** 與 `code`');
    expect(html).toContain('<strong>重點</strong>');
    expect(html).toContain('<code>code</code>');
  });

  it('把惡意 HTML 當純文字呈現，不建立節點', () => {
    const { container } = render(
      <div dangerouslySetInnerHTML={{ __html: renderMarkdown('<img src=x onerror="x">') }} />
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x');
  });
});

describe('題庫解析必須被看見', () => {
  it('揭曉答案後顯示人工解析', () => {
    render(
      <QuestionCard
        question={{ ...base, explanation: '這是人工審核過的解析。' }}
        questionNumber={1}
        showAnswer
        onSelectAnswer={vi.fn()}
      />
    );
    expect(screen.getByLabelText('題庫解析')).toBeInTheDocument();
    expect(screen.getByText('這是人工審核過的解析。')).toBeInTheDocument();
  });

  it('AI 按鈕明示未經人工審核', () => {
    render(
      <QuestionCard question={base} questionNumber={1} showAnswer onSelectAnswer={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: /未經人工審核/ })).toBeInTheDocument();
  });

  it('沒有解析的題目不出現空區塊', () => {
    render(
      <QuestionCard question={base} questionNumber={1} showAnswer onSelectAnswer={vi.fn()} />
    );
    expect(screen.queryByLabelText('題庫解析')).not.toBeInTheDocument();
  });

  it('未分類的考科顯示「待分類」，不冒充考科二', () => {
    render(
      <QuestionCard
        question={{ ...base, subject: null }}
        questionNumber={1}
        onSelectAnswer={vi.fn()}
      />
    );
    expect(screen.getByText('待分類')).toBeInTheDocument();
    expect(screen.queryByText('考科二')).not.toBeInTheDocument();
  });
});
