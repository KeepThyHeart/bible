import { render, screen } from '@testing-library/react';
import { ProgressRing } from './ProgressRing';

describe('ProgressRing', () => {
  it('is a named progressbar with the value in the middle', () => {
    render(<ProgressRing value={42.4} label="Gospels: progress" />);
    const ring = screen.getByRole('progressbar', { name: 'Gospels: progress' });
    expect(ring).toHaveAttribute('aria-valuenow', '42.4');
    expect(ring).toHaveTextContent('42%');
    expect(ring).toHaveAttribute('data-size', 'md');
  });

  it('clamps, takes its own value text and size, and draws no arc at zero', () => {
    const { container, rerender } = render(<ProgressRing value={140} label="x" valueText="all" size="sm" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByRole('progressbar')).toHaveTextContent('all');
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-size', 'sm');
    rerender(<ProgressRing value={0} label="x" />);
    expect(container.querySelector('.kth-progress-ring__fill')).toBeNull();
  });
});
