import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { flushSync } from 'react-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useFocusTrap } from './useFocusTrap';

const Dialog: React.FC<{ id: string; onClose: () => void; modal?: boolean; children?: React.ReactNode }> = ({
  id,
  onClose,
  modal,
  children,
}) => {
  const ref = useFocusTrap<HTMLDivElement>(true, onClose, { modal });
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={id} data-testid={id}>
      <button>{id}-button</button>
      {children}
    </div>
  );
};

const App: React.FC<{ modal?: boolean }> = ({ modal }) => {
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  return (
    <div>
      <div data-testid="page">
        <button onClick={() => setA(true)}>open-a</button>
      </div>
      <div data-testid="other">other</div>
      {a && (
        <Dialog id="dlg-a" onClose={() => setA(false)} modal={modal}>
          <button onClick={() => setB(true)}>open-b</button>
        </Dialog>
      )}
      {b && <Dialog id="dlg-b" onClose={() => setB(false)} modal={modal} />}
    </div>
  );
};

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

describe('useFocusTrap inert background', () => {
  it('inerts the page while a modal is open and restores it on close', async () => {
    render(<App />);
    fireEvent.click(screen.getByText('open-a'));
    await flush();
    expect(screen.getByTestId('page')).toHaveAttribute('inert');
    expect(screen.getByTestId('other')).toHaveAttribute('inert');
    expect(screen.getByTestId('dlg-a')).not.toHaveAttribute('inert');
    fireEvent.keyDown(screen.getByTestId('dlg-a'), { key: 'Escape' });
    await flush();
    expect(screen.getByTestId('page')).not.toHaveAttribute('inert');
    expect(screen.getByTestId('other')).not.toHaveAttribute('inert');
  });

  it('nested dialog inerts the one beneath it and restores it when closed', async () => {
    render(<App />);
    fireEvent.click(screen.getByText('open-a'));
    await flush();
    fireEvent.click(screen.getByText('open-b'));
    await flush();
    expect(screen.getByTestId('dlg-b')).not.toHaveAttribute('inert');
    expect(screen.getByTestId('dlg-a')).toHaveAttribute('inert');
    fireEvent.keyDown(screen.getByTestId('dlg-b'), { key: 'Escape' });
    await flush();
    expect(screen.queryByTestId('dlg-b')).toBeNull();
    expect(screen.getByTestId('dlg-a')).not.toHaveAttribute('inert');
    // The page stays inert because dialog A is still open.
    expect(screen.getByTestId('page')).toHaveAttribute('inert');
  });

  it('leaves the page alone for a non-modal trap', async () => {
    render(<App modal={false} />);
    fireEvent.click(screen.getByText('open-a'));
    await flush();
    expect(screen.getByTestId('page')).not.toHaveAttribute('inert');
  });

  it('returns focus to the opener when the focused opener is gone (menu item removed)', async () => {
    function Host() {
      const [menu, setMenu] = useState(false);
      const [dlg, setDlg] = useState(false);
      return (
        <div>
          <button onClick={() => setMenu(true)}>help-button</button>
          {menu && (
            <div role="menu">
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  setDlg(true);
                }}
              >
                item
              </button>
            </div>
          )}
          <h2 tabIndex={-1}>heading</h2>
          {dlg && <Dialog id="dlg" onClose={() => setDlg(false)} />}
        </div>
      );
    }
    render(<Host />);
    const helpButton = screen.getByText('help-button');
    helpButton.focus();
    fireEvent.click(helpButton);
    await flush();
    const item = screen.getByText('item');
    item.focus();
    fireEvent.click(item);
    await flush();
    expect(screen.getByTestId('dlg')).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId('dlg'), { key: 'Escape' });
    await flush();
    expect(document.activeElement).toBe(helpButton);
  });

  it('cancels the Enter keydown that closed it, so its keypress cannot click the refocused opener', async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button onClick={() => setOpen(true)}>opener</button>
          {open && (
            <Dialog id="picker" onClose={() => setOpen(false)}>
              <input
                aria-label="filter"
                onKeyDown={(e) => {
                  // flushSync: commit (and release the trap) while the keydown
                  // is still being dispatched, as the app's event loop does.
                  if (e.key === 'Enter') flushSync(() => setOpen(false));
                }}
              />
            </Dialog>
          )}
        </div>
      );
    }
    render(<Host />);
    const opener = screen.getByText('opener');
    opener.focus();
    fireEvent.click(opener);
    await flush();
    const input = screen.getByLabelText('filter');
    input.focus();
    // fireEvent returns false when a handler called preventDefault().
    const notCancelled = fireEvent.keyDown(input, { key: 'Enter' });
    await flush();
    expect(screen.queryByTestId('picker')).toBeNull();
    expect(notCancelled).toBe(false);
    expect(document.activeElement).toBe(opener);
  });
});
