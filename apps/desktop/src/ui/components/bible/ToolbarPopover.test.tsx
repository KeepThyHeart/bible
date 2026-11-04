import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
