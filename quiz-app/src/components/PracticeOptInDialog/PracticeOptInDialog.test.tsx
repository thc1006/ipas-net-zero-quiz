// PracticeOptInDialog 元件測試（focus trap / ESC / overlay click / aria）
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PracticeOptInDialog } from './PracticeOptInDialog';

afterEach(() => cleanup());

describe('PracticeOptInDialog', () => {
  it('renders nothing when not open', () => {
    const { container } = render(
      <PracticeOptInDialog open={false} onAccept={() => {}} onDecline={() => {}} />
    );
    expect(container.querySelector('.optin-dialog')).toBeNull();
  });

  it('renders dialog with role and aria-labelledby/-describedby', () => {
    render(<PracticeOptInDialog open onAccept={() => {}} onDecline={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'optin-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'optin-desc');
    expect(document.getElementById('optin-title')).toHaveTextContent('啟用加強練習池');
    expect(document.getElementById('optin-desc')).toBeInTheDocument();
  });

  it('calls onAccept when accept button clicked', () => {
    const onAccept = vi.fn();
    render(<PracticeOptInDialog open onAccept={onAccept} onDecline={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /我已了解/ }));
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it('calls onDecline when decline button clicked', () => {
    const onDecline = vi.fn();
    render(<PracticeOptInDialog open onAccept={() => {}} onDecline={onDecline} />);
    fireEvent.click(screen.getByRole('button', { name: /暫不啟用/ }));
    expect(onDecline).toHaveBeenCalledOnce();
  });

  it('calls onDecline when ESC pressed', () => {
    const onDecline = vi.fn();
    render(<PracticeOptInDialog open onAccept={() => {}} onDecline={onDecline} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDecline).toHaveBeenCalledOnce();
  });

  it('calls onDecline when overlay (not dialog) clicked', () => {
    const onDecline = vi.fn();
    const { container } = render(
      <PracticeOptInDialog open onAccept={() => {}} onDecline={onDecline} />
    );
    const overlay = container.querySelector('.optin-overlay') as HTMLElement;
    // Click overlay element itself (not children)
    fireEvent.click(overlay, { target: overlay, currentTarget: overlay });
    // jsdom event target is the actual element clicked; use bubbled click on overlay
    // Re-trigger via direct dispatch — bypass React synthetic event detail issues
    // Above call is the standard approach
    expect(onDecline).toHaveBeenCalled();
  });

  it('does NOT call onDecline when clicking inside the dialog', () => {
    const onDecline = vi.fn();
    render(<PracticeOptInDialog open onAccept={() => {}} onDecline={onDecline} />);
    fireEvent.click(screen.getByText(/iPAS 不公開歷屆/));
    expect(onDecline).not.toHaveBeenCalled();
  });

  it('focuses first focusable element on open', async () => {
    render(<PracticeOptInDialog open onAccept={() => {}} onDecline={() => {}} />);
    // First focusable button is "暫不啟用"
    const decline = screen.getByRole('button', { name: /暫不啟用/ });
    // useEffect runs synchronously enough in jsdom for focus to land
    expect(document.activeElement).toBe(decline);
  });

  it('sets aria-hidden on #root while open and restores on close', () => {
    // create #root
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);

    const { rerender } = render(
      <PracticeOptInDialog open onAccept={() => {}} onDecline={() => {}} />
    );
    expect(root.getAttribute('aria-hidden')).toBe('true');

    rerender(<PracticeOptInDialog open={false} onAccept={() => {}} onDecline={() => {}} />);
    expect(root.getAttribute('aria-hidden')).toBeNull();

    document.body.removeChild(root);
  });
});
