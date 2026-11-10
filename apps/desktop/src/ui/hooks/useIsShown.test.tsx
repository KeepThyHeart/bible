import { describe, it, expect } from 'vitest';
import { act, render } from '@testing-library/react';
import React, { useRef } from 'react';
import { useIsShown } from './useIsShown';

function Probe(): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useIsShown(() => ref.current);
  return <div ref={ref} data-testid="probe" data-shown={String(shown)} />;
}

describe('useIsShown', () => {
  it('is true when nothing above the element is hidden', () => {
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('probe').dataset.shown).toBe('true');
  });

  it('is false inside a [hidden] wrapper, and true again once it is shown', async () => {
    const wrapper = document.createElement('div');
    wrapper.hidden = true;
    document.body.appendChild(wrapper);
    const { getByTestId } = render(<Probe />, { container: wrapper.appendChild(document.createElement('div')) });
    expect(getByTestId('probe').dataset.shown).toBe('false');

    await act(async () => {
      wrapper.hidden = false;
      await Promise.resolve();
    });
    expect(getByTestId('probe').dataset.shown).toBe('true');
    wrapper.remove();
  });
});
