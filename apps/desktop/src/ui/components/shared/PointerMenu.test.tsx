import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PointerMenu, { placePointerMenu } from './PointerMenu';

describe('placePointerMenu', () => {
  const vw = 1000;
  const vh = 800;

  it('opens at the pointer when it fits', () => {
    expect(placePointerMenu(100, 100, 200, 300, vw, vh, 'ltr', 8)).toEqual({ top: 100, insetInlineStart: 100 });
  });

  it('opens upward from the pointer when there is no room below', () => {
    expect(placePointerMenu(100, 700, 200, 300, vw, vh, 'ltr', 8).top).toBe(400);
  });

  it('pins to the bottom edge when there is no room above or below', () => {
    expect(placePointerMenu(100, 200, 200, 700, vw, vh, 'ltr', 8).top).toBe(92);
  });

  it('never goes above the top edge for a menu taller than the window', () => {
    expect(placePointerMenu(100, 200, 200, 900, vw, vh, 'ltr', 8).top).toBe(8);
  });

  it('flips toward the pointer near the inline-end edge, in both directions', () => {
    // LTR: no room to the right of x=950, so it ends at the pointer instead.
    expect(placePointerMenu(950, 100, 200, 100, vw, vh, 'ltr', 8).insetInlineStart).toBe(750);
    // RTL: x=50 is 950 from the right edge; same flip, measured from the right.
    expect(placePointerMenu(50, 100, 200, 100, vw, vh, 'rtl', 8).insetInlineStart).toBe(750);
  });
});

describe('PointerMenu', () => {
  it('renders into document.body, out of the pane that declared it', () => {
    const { container } = render(
      <div data-testid="pane">
        <PointerMenu x={10} y={20} role="menu" aria-label="Menu"><button role="menuitem">Item</button></PointerMenu>
      </div>,
    );
    const menu = screen.getByRole('menu');
    expect(container.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.position).toBe('fixed');
  });

  it('still bubbles React events to the component that rendered it', () => {
    const onClick = vi.fn();
    render(
      <div onClick={onClick}>
        <PointerMenu x={10} y={20} role="menu"><button role="menuitem">Item</button></PointerMenu>
      </div>,
    );
    fireEvent.click(screen.getByRole('menuitem'));
    expect(onClick).toHaveBeenCalled();
  });

  it('forwards its ref', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<PointerMenu ref={ref} x={0} y={0} role="menu" />);
    expect(ref.current).toBe(screen.getByRole('menu'));
  });
});
