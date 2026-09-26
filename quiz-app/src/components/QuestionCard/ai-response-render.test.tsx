// AI 區塊的三條渲染路徑：載入中、成功、失敗。
// 這些路徑先前沒有任何測試走到 —— 而它們正是把第三方輸出放進 DOM 的地方。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { QuizQuestion } from '../../types/quiz';

const explainQuestion = vi.fn();
vi.mock('../../utils/ai-helper', () => ({
  explainQuestion: (...args: unknown[]) => explainQuestion(...args),
}));

const { QuestionCard } = await import('./QuestionCard');

const question: QuizQuestion = {
  id: 'ai-1',
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

function clickAI() {
  fireEvent.click(screen.getByRole('button', { name: /未經人工審核/ }));
}

describe('AI 區塊渲染', () => {
  beforeEach(() => {
    explainQuestion.mockReset();
  });

  it('請求中顯示載入狀態', async () => {
    let resolve: (v: unknown) => void = () => {};
    explainQuestion.mockReturnValue(new Promise((r) => { resolve = r; }));

    render(<QuestionCard question={question} questionNumber={1} showAnswer onSelectAnswer={vi.fn()} />);
    clickAI();

    expect(await screen.findByText(/AI 分析中/)).toBeInTheDocument();
    resolve({ success: true, content: '完成', confidence: 0.9 });
    await waitFor(() => expect(screen.queryByText(/AI 分析中/)).not.toBeInTheDocument());
  });

  it('成功時逐段渲染內容，且惡意 HTML 不會變成節點', async () => {
    explainQuestion.mockResolvedValue({
      success: true,
      content: '**第一段**\n<img src=x onerror="window.__xss=1">',
      confidence: 0.85,
    });

    const { container } = render(
      <QuestionCard question={question} questionNumber={1} showAnswer onSelectAnswer={vi.fn()} />
    );
    clickAI();

    expect(await screen.findByText('第一段')).toBeInTheDocument();
    expect(container.querySelector('.ai-response-content strong')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x');
  });

  it('不顯示憑空生成的信心度百分比，只據實說明內容性質', async () => {
    // estimateConfidence 是依「回覆長度、有沒有出現 A/B、命中幾個關鍵詞」加總出來的，
    // 與答案正確與否無關。把它渲染成「信心度 85%」，是一個看起來精確卻憑空生成的數字。
    explainQuestion.mockResolvedValue({ success: true, content: '內容', confidence: 0.85 });

    render(<QuestionCard question={question} questionNumber={1} showAnswer onSelectAnswer={vi.fn()} />);
    clickAI();

    expect(await screen.findByText('未經人工審核')).toBeInTheDocument();
    expect(screen.queryByText(/信心度/)).not.toBeInTheDocument();
    expect(screen.queryByText(/85%/)).not.toBeInTheDocument();
  });

  it('失敗時顯示錯誤訊息而不是空白', async () => {
    explainQuestion.mockResolvedValue({
      success: false,
      content: '',
      confidence: 0,
      error: 'AI 服務暫時無法使用',
    });

    render(<QuestionCard question={question} questionNumber={1} showAnswer onSelectAnswer={vi.fn()} />);
    clickAI();

    expect(await screen.findByText('AI 服務暫時無法使用')).toBeInTheDocument();
  });

  it('explainQuestion 丟例外時也給可讀訊息，不讓畫面炸掉', async () => {
    explainQuestion.mockRejectedValue(new Error('boom'));

    render(<QuestionCard question={question} questionNumber={1} showAnswer onSelectAnswer={vi.fn()} />);
    clickAI();

    expect(await screen.findByText(/請求失敗/)).toBeInTheDocument();
  });
});
