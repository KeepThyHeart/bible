/**
 * The pane splitter must not paint over - or stay hoverable through - any
 * dialog opened from inside a dockview pane.
 *
 * Dockview's `.dv-dockview` sets `contain: layout`, which makes it both a
 * stacking context and the containing block for `position: fixed` descendants.
 * A dialog rendered where it sat in the tree therefore never reached the
 * document, and its `z-index: 50` competed with `.dv-sash { z-index: 99 }`
 * inside that same context - 99 wins. Portalling to `<body>` is the fix, the
 * same one `bible/ToolbarPopover` already used for the toolbar menus.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PaneOverlay } from './PaneOverlay';

describe('PaneOverlay', () => {
  it('renders outside the pane it was mounted in, so the dockview sash cannot outrank it', () => {
    const { container } = render(
      <div data-testid="pane">
        <PaneOverlay onDismiss={vi.fn()} testId="overlay">
          <div>Contents</div>
        </PaneOverlay>
      </div>,
    );

    const overlay = screen.getByTestId('overlay');
    expect(overlay).toBeInTheDocument();
    // The whole point: it is a child of <body>, not of the pane.
    expect(container.querySelector('[data-testid="overlay"]')).toBeNull();
    expect(overlay.parentElement).toBe(document.body);
  });

  it('sits above the sash', () => {
    render(
      <PaneOverlay onDismiss={vi.fn()} testId="overlay">
        <div>Contents</div>
      </PaneOverlay>,
    );

    // `.dv-sash` is z-index 99 (dockview's own stylesheet).
    expect(Number(screen.getByTestId('overlay').style.zIndex)).toBeGreaterThan(99);
  });

  it('dismisses on a backdrop click', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <PaneOverlay onDismiss={onDismiss} testId="overlay">
        <div>Contents</div>
      </PaneOverlay>,
    );

    await user.click(screen.getByTestId('overlay'));

    expect(onDismiss).toHaveBeenCalled();
  });

  it('leaves a click inside the dialog alone when the dialog stops propagation', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <PaneOverlay onDismiss={onDismiss} testId="overlay">
        <div onClick={(e) => e.stopPropagation()}>
          <button type="button">Do something</button>
        </div>
      </PaneOverlay>,
    );

    await user.click(screen.getByRole('button', { name: 'Do something' }));

    expect(onDismiss).not.toHaveBeenCalled();
  });
});
