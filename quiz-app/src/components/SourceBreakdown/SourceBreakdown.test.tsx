// SourceBreakdown 測試
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SourceBreakdown, computeBreakdown } from './SourceBreakdown';
import type { AnswerRecord } from '../../types/quiz';

afterEach(cleanup);

function ans(
  isCorrect: boolean,
  cat?: AnswerRecord['sourceCategory'],
): AnswerRecord {
  return {
    questionId: Math.random().toString(),
    selectedAnswer: 'A',
    correctAnswer: isCorrect ? 'A' : 'B',
    isCorrect,
    timeSpent: 1000,
    timestamp: Date.now(),
    sourceCategory: cat,
  };
}

describe('computeBreakdown', () => {
  it('groups by sourceCategory + counts correct/total', () => {
    const groups = computeBreakdown([
      ans(true, 'main_bank'),
      ans(true, 'main_bank'),
      ans(false, 'main_bank'),
      ans(true, 'external_mock'),
      ans(false, 'ai_generated'),
      ans(false, 'ai_generated'),
    ]);
    const main = groups.find((g) => g.key === 'main_bank');
    expect(main?.total).toBe(3);
    expect(main?.correct).toBe(2);
    const ai = groups.find((g) => g.key === 'ai_generated');
    expect(ai?.total).toBe(2);
    expect(ai?.correct).toBe(0);
  });

  it('skips empty groups', () => {
    const groups = computeBreakdown([ans(true, 'main_bank')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('main_bank');
  });

  it('skips answers with isCorrect=null (skipped questions)', () => {
    const skipped: AnswerRecord = {
      ...ans(false, 'main_bank'),
      isCorrect: null,
    };
    const groups = computeBreakdown([ans(true, 'main_bank'), skipped]);
    expect(groups[0].total).toBe(1);
  });

  it('defaults missing sourceCategory to main_bank', () => {
    const noCategoryAns: AnswerRecord = {
      questionId: 'x',
      selectedAnswer: 'A',
      correctAnswer: 'A',
      isCorrect: true,
      timeSpent: 100,
      timestamp: 0,
      // no sourceCategory
    };
    const groups = computeBreakdown([noCategoryAns]);
    expect(groups[0].key).toBe('main_bank');
  });
});

describe('SourceBreakdown', () => {
  it('renders section when ≥2 source groups', () => {
    render(
      <SourceBreakdown
        answers={[ans(true, 'main_bank'), ans(true, 'ai_generated')]}
      />,
    );
    expect(screen.getByText('分項正確率')).toBeInTheDocument();
    expect(screen.getByText('主題庫')).toBeInTheDocument();
    expect(screen.getByText('AI 產題')).toBeInTheDocument();
  });

  it('renders nothing when only 1 source group', () => {
    const { container } = render(
      <SourceBreakdown answers={[ans(true, 'main_bank')]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when no answers', () => {
    const { container } = render(<SourceBreakdown answers={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('flags low accuracy (<60%) on pool groups', () => {
    const { container } = render(
      <SourceBreakdown
        answers={[
          // main_bank 100%
          ans(true, 'main_bank'),
          ans(true, 'main_bank'),
          // ai_generated 50% (1/2) → flagged low
          ans(true, 'ai_generated'),
          ans(false, 'ai_generated'),
        ]}
      />,
    );
    expect(container.querySelector('.source-breakdown__row--low')).toBeTruthy();
    expect(screen.getByText(/⚠ 偏低/)).toBeInTheDocument();
  });

  it('does NOT flag main_bank low accuracy (no special warning for main)', () => {
    const { container } = render(
      <SourceBreakdown
        answers={[
          ans(false, 'main_bank'),
          ans(false, 'main_bank'),
          ans(true, 'external_mock'),
        ]}
      />,
    );
    // main 0% but no --low class on main row
    const mainRow = container.querySelector('.source-breakdown__row--main');
    expect(mainRow?.className).not.toMatch(/source-breakdown__row--low/);
  });

  it('shows learning hint when main_bank present', () => {
    render(
      <SourceBreakdown
        answers={[ans(true, 'main_bank'), ans(true, 'ai_generated')]}
      />,
    );
    expect(screen.getByText(/真實 iPAS 模擬考水準/)).toBeInTheDocument();
  });
});
