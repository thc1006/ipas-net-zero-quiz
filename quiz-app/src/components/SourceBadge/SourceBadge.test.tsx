// SourceBadge component test
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SourceBadge } from './SourceBadge';

afterEach(() => cleanup());

describe('SourceBadge', () => {
  it('renders external_mock with 模擬題 label', () => {
    render(<SourceBadge sourceType="external_mock" />);
    expect(screen.getByText('模擬題')).toBeInTheDocument();
  });

  it('renders ai_generated with AI 產題 label', () => {
    render(<SourceBadge sourceType="ai_generated" />);
    expect(screen.getByText('AI 產題')).toBeInTheDocument();
  });

  it('compact mode hides badge text', () => {
    const { container } = render(
      <SourceBadge sourceType="ai_generated" compact />
    );
    expect(container.querySelector('.badge-text')).toBeNull();
  });

  it('renders quality_flags chips', () => {
    render(
      <SourceBadge
        sourceType="external_mock"
        qualityFlags={['time_sensitive', 'ambiguous']}
      />
    );
    expect(screen.getByText('時效')).toBeInTheDocument();
    expect(screen.getByText('爭議')).toBeInTheDocument();
  });

  it('ignores unknown quality flag', () => {
    render(
      <SourceBadge
        sourceType="external_mock"
        qualityFlags={['unmapped_subject', 'duplicate_topic']}
      />
    );
    // FLAG_LABEL only has time_sensitive/ambiguous/low_confidence; others rendered as nothing
    expect(screen.queryByText('unmapped_subject')).toBeNull();
  });

  it('ai_generated badge has tone-ai class for warning color', () => {
    const { container } = render(<SourceBadge sourceType="ai_generated" />);
    const badge = container.querySelector('.source-badge');
    expect(badge?.classList.contains('tone-ai')).toBe(true);
  });

  it('disclosure title text references EU AI Act for ai_generated', () => {
    render(<SourceBadge sourceType="ai_generated" />);
    const badge = screen.getByLabelText(/EU AI Act/);
    expect(badge).toBeInTheDocument();
  });
});
