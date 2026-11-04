import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { useModalFocus } from './useModalFocus';

function Harness({ open }: { open: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(open, ref);
  return (
    <div>
      <button data-testid="opener">open</button>
      {open && (
        <div ref={ref} role="dialog" aria-modal="true" data-testid="dlg">
          <button data-testid="a">a</button>
          <button data-testid="b">b</button>
        </div>
      )}
    </div>
  );
}

const flush = () => new Promise((r) => setTimeout(r, 50));

describe('useModalFocus', () => {
  afterEach(cleanup);

  it('moves focus into the dialog, wraps Tab, and restores focus to the opener', async () => {
    const { getByTestId, rerender } = render(<Harness open={false} />);
    const opener = getByTestId('opener');
    opener.focus();
    rerender(<Harness open />);
    await flush();
    const dlg = getByTestId('dlg');
    expect(dlg.contains(document.activeElement)).toBe(true);

    // Tab on the last control wraps to the first
    getByTestId('b').focus();
    expect(fireEvent.keyDown(document.activeElement!, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(getByTestId('a'));
    // Shift+Tab on the first wraps to the last
    expect(fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(getByTestId('b'));

    rerender(<Harness open={false} />);
    await flush();
    expect(document.activeElement).toBe(opener);
  });
});
