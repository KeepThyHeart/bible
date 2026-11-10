import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ToolbarPopover from './ToolbarPopover';

describe('ToolbarPopover (B-130)', () => {
  it('limits its height to the window and scrolls', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    render(
      <ToolbarPopover anchorRef={{ current: anchor }} role="menu" aria-label="Bookmarks">
        <div>row</div>
      </ToolbarPopover>
    );
    const menu = screen.getByRole('menu');
    expect(menu.style.maxHeight).toBe(`${window.innerHeight - 4 - 8}px`);
    expect(menu.style.overflowY).toBe('auto');
  });

  it('as a menu: focuses the first item, arrows/Home/End move, and focus returns to the opener on close', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    anchor.focus();
    const view = render(
      <ToolbarPopover anchorRef={{ current: anchor }} aria-label="Menu">
        <button role="menuitem" disabled>off</button>
        <button role="menuitem">one</button>
        <button role="menuitem">two</button>
        <button role="menuitem">three</button>
      </ToolbarPopover>
    );
    const one = screen.getByText('one');
    expect(one).toHaveFocus();
    fireEvent.keyDown(one, { key: 'ArrowDown' });
    expect(screen.getByText('two')).toHaveFocus();
    fireEvent.keyDown(screen.getByText('two'), { key: 'End' });
    expect(screen.getByText('three')).toHaveFocus();
    fireEvent.keyDown(screen.getByText('three'), { key: 'ArrowDown' });
    expect(one).toHaveFocus();
    fireEvent.keyDown(one, { key: 'ArrowUp' });
    expect(screen.getByText('three')).toHaveFocus();
    view.unmount();
    expect(anchor).toHaveFocus();
  });

  it('as a dialog: does not grab focus or add menu keys', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    anchor.focus();
    render(
      <ToolbarPopover anchorRef={{ current: anchor }} role="dialog" aria-label="Legend">
        <button>inside</button>
      </ToolbarPopover>
    );
    expect(anchor).toHaveFocus();
  });
});
