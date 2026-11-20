import { render, screen } from '@testing-library/react';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
  it('exposes progressbar semantics and the fill width', () => {
    const { container } = render(<ProgressBar value={42} label="Plan progress" valueText="42%" />);
    const bar = screen.getByRole('progressbar', { name: 'Plan progress' });
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect((container.querySelector('.kth-progress__fill') as HTMLElement).style.inlineSize).toBe('42%');
    expect(screen.getByText('42%')).toHaveClass('kth-progress__value');
  });

  it('clamps out-of-range and non-finite values', () => {
    const { rerender } = render(<ProgressBar value={150} label="p" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    rerender(<ProgressBar value={-5} label="p" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    rerender(<ProgressBar value={Number.NaN} label="p" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('success tone', () => {
    const { container } = render(<ProgressBar value={10} label="p" tone="success" />);
    expect(container.querySelector('.kth-progress__fill')).toHaveClass('kth-progress__fill--success');
  });
});
