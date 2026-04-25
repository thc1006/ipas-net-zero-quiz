// HomePage component test — practice mode indicator + start callback
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { HomePage } from './HomePage';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('HomePage', () => {
  it('renders title and stats badges', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    expect(screen.getByText(/淨零碳備考神器/)).toBeInTheDocument();
    // stats badges
    expect(screen.getByText(/考科一/)).toBeInTheDocument();
    expect(screen.getByText(/考科二/)).toBeInTheDocument();
  });

  it('does NOT show practice-pool indicator when disabled', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    expect(screen.queryByText(/加強練習池啟用中/)).toBeNull();
  });

  it('shows practice-pool indicator when enabled', () => {
    localStorage.setItem('practice-pool-enabled', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    expect(screen.getByText(/加強練習池啟用中/)).toBeInTheDocument();
  });

  it('calls onStartQuiz with current config when 開始 clicked', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const startBtn = screen.getByRole('button', { name: /開始/ });
    fireEvent.click(startBtn);
    expect(onStartQuiz).toHaveBeenCalledOnce();
    const config = onStartQuiz.mock.calls[0][0];
    expect(config).toHaveProperty('mode');
    expect(config).toHaveProperty('subject');
    expect(config).toHaveProperty('questionCount');
  });
});
