import * as React from 'react';
import { render, screen } from '@testing-library/react';

describe('test runtime', () => {
  it('runs on the runtime this project claims', () => {
    // preact/compat puts createPortal on the `react` namespace; React 18 does not.
    const isCompat = typeof (React as Record<string, unknown>).createPortal === 'function';
    expect(isCompat).toBe(process.env.KTH_UI_RUNTIME === 'preact');
  });

  it('renders JSX through the selected runtime', () => {
    render(<button type="button">hello</button>);
    expect(screen.getByRole('button', { name: 'hello' })).toBeInTheDocument();
  });
});
