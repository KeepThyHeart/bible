import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { useModalFocus, setModalFallback } from './useModalFocus';

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

function Nested({ a, b }: { a: boolean; b: boolean }) {
  const ra = useRef<HTMLDivElement>(null);
  const rb = useRef<HTMLDivElement>(null);
  useModalFocus(a, ra);
  useModalFocus(b, rb);
  return (
    <div data-testid="root">
      <header data-testid="page"><button>page</button></header>
      <div role="status" aria-live="polite" data-testid="live" />
      <script data-testid="script" />
      {a && <div ref={ra} role="dialog" aria-modal="true" data-testid="A"><button>a</button></div>}
      {b && <div ref={rb} role="dialog" aria-modal="true" data-testid="B"><button>b</button></div>}
    </div>
  );
}

describe('useModalFocus inert background', () => {
  afterEach(cleanup);

  it('makes everything outside the open modal inert and restores it on close', async () => {
    const { getByTestId, rerender } = render(<Nested a={false} b={false} />);
    rerender(<Nested a b={false} />);
    await flush();
    expect(getByTestId('page').hasAttribute('inert')).toBe(true);
    expect(getByTestId('A').hasAttribute('inert')).toBe(false);
    // live regions and non-content elements are left alone
    expect(getByTestId('live').hasAttribute('inert')).toBe(false);
    expect(getByTestId('script').hasAttribute('inert')).toBe(false);
    rerender(<Nested a={false} b={false} />);
    await flush();
    expect(getByTestId('page').hasAttribute('inert')).toBe(false);
  });

  it('keeps an element that was already inert inert after the modal closes', async () => {
    const { getByTestId, rerender } = render(<Nested a={false} b={false} />);
    getByTestId('page').setAttribute('inert', '');
    rerender(<Nested a b={false} />);
    await flush();
    rerender(<Nested a={false} b={false} />);
    await flush();
    expect(getByTestId('page').hasAttribute('inert')).toBe(true);
  });

  it('nested modals: the lower one is inert while the upper is open and is restored when it closes', async () => {
    const { getByTestId, rerender } = render(<Nested a b={false} />);
    await flush();
    rerender(<Nested a b />);
    await flush();
    expect(getByTestId('A').hasAttribute('inert')).toBe(true);
    expect(getByTestId('B').hasAttribute('inert')).toBe(false);
    expect(getByTestId('page').hasAttribute('inert')).toBe(true);
    rerender(<Nested a b={false} />);
    await flush();
    expect(getByTestId('A').hasAttribute('inert')).toBe(false);
    expect(getByTestId('page').hasAttribute('inert')).toBe(true);
    rerender(<Nested a={false} b={false} />);
    await flush();
    expect(getByTestId('page').hasAttribute('inert')).toBe(false);
    expect(document.querySelectorAll('[inert]').length).toBe(0);
  });
});

describe('setModalFallback', () => {
  afterEach(cleanup);

  it('returns focus to the registered fallback when the opener vanished before the dialog closed', async () => {
    function Wrap({ stage }: { stage: 0 | 1 | 2 }) {
      // stage 1: popup with an item is up; stage 2: popup gone, dialog open; stage 0: all closed
      const r = useRef<HTMLDivElement>(null);
      useModalFocus(stage === 2, r);
      return (
        <div>
          <button data-testid="theme">theme</button>
          {stage === 1 && <button data-testid="more">more</button>}
          {stage === 2 && <div ref={r} role="dialog"><button>in</button></div>}
        </div>
      );
    }
    const { getByTestId, rerender } = render(<Wrap stage={0} />);
    rerender(<Wrap stage={1} />);
    await flush();
    const more = getByTestId('more');
    more.focus();
    setModalFallback(more, getByTestId('theme'));
    rerender(<Wrap stage={2} />);
    await flush();
    rerender(<Wrap stage={0} />);
    await flush();
    expect(document.activeElement).toBe(getByTestId('theme'));
  });
});
