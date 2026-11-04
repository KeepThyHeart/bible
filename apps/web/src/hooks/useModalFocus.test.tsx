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

function Chain({ stage }: { stage: 0 | 1 | 2 }) {
  // stage 0: closed; 1: parent dialog (with its own opener button) open; 2: parent closed, child open
  const r1 = useRef<HTMLDivElement>(null);
  const r2 = useRef<HTMLDivElement>(null);
  useModalFocus(stage === 1, r1);
  useModalFocus(stage === 2, r2);
  return (
    <div>
      <button data-testid="root-opener">root</button>
      {stage === 1 && (
        <div ref={r1} role="dialog" data-testid="d1"><button data-testid="inner-opener">more</button></div>
      )}
      {stage === 2 && (
        <div ref={r2} role="dialog" data-testid="d2"><button>x</button></div>
      )}
    </div>
  );
}

function Mounted() {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(true, ref);
  return <div ref={ref} role="dialog"><button>in</button></div>;
}

describe('useModalFocus (B-156)', () => {
  afterEach(cleanup);

  it('falls back to the parent dialog opener when the opener was unmounted', async () => {
    const { getByTestId, rerender } = render(<Chain stage={0} />);
    const root = getByTestId('root-opener');
    root.focus();
    rerender(<Chain stage={1} />);
    await flush();
    getByTestId('inner-opener').focus();
    rerender(<Chain stage={2} />); // parent closes as the child opens
    await flush();
    rerender(<Chain stage={0} />);
    await flush();
    expect(document.activeElement).toBe(root);
  });

  it('restores focus when the dialog component unmounts while open', async () => {
    const Wrap = ({ open }: { open: boolean }) => (
      <div><button data-testid="op">op</button>{open && <Mounted />}</div>
    );
    const { getByTestId, rerender } = render(<Wrap open={false} />);
    const op = getByTestId('op');
    op.focus();
    rerender(<Wrap open />);
    await flush();
    rerender(<Wrap open={false} />);
    await flush();
    expect(document.activeElement).toBe(op);
  });

  it('returns to the parent opener when the parent unmounted a render before the child opened', async () => {
    const { getByTestId, rerender } = render(<Chain stage={0} />);
    const root = getByTestId('root-opener');
    root.focus();
    rerender(<Chain stage={1} />);
    await flush();
    getByTestId('inner-opener').focus();
    (document.activeElement as HTMLElement).blur(); // parent removed first: focus is on BODY when the child renders
    rerender(<Chain stage={2} />);
    await flush();
    rerender(<Chain stage={0} />);
    await flush();
    expect(document.activeElement).toBe(root);
  });
});
