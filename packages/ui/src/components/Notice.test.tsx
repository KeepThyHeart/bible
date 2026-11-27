import { render, screen } from '@testing-library/react';
import { Notice } from './Notice';

describe('Notice', () => {
  it('defaults to an info note with title, text and actions', () => {
    render(<Notice title="Heads up" actions={<button type="button">Fix</button>}>Something changed</Notice>);
    const n = screen.getByRole('note');
    expect(n).toHaveClass('kth-notice', 'kth-notice--info');
    expect(screen.getByText('Heads up')).toHaveClass('kth-notice__title');
    expect(screen.getByText('Something changed')).toHaveClass('kth-notice__text');
    expect(screen.getByRole('button', { name: 'Fix' })).toBeInTheDocument();
  });

  it('errors are alerts by default; role can be overridden', () => {
    const { rerender } = render(<Notice tone="error">Failed</Notice>);
    expect(screen.getByRole('alert')).toHaveClass('kth-notice--error');
    rerender(<Notice tone="success" role="status">Saved</Notice>);
    expect(screen.getByRole('status')).toHaveClass('kth-notice--success');
    rerender(<Notice tone="warning">Careful</Notice>);
    expect(screen.getByRole('note')).toHaveClass('kth-notice--warning');
  });
});
