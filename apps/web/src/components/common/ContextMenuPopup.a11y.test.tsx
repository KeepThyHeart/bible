/** W-038: keyboard behaviour of the verse context menu (focus in, arrow keys, roles). */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

import { ContextMenuPopup } from './ContextMenuPopup';

function open() {
  const menuRef = { current: null };
  const utils = render(
    <ContextMenuPopup x={10} y={10} menuRef={menuRef} onAction={vi.fn()}
      actions={[{ id: 'present', label: 'Present', group: 'other' }]} onVerseAction={vi.fn()} />,
  );
  const menu = utils.container.querySelector<HTMLElement>('[role="menu"]')!;
  const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  return { menu, items };
}

describe('ContextMenuPopup keyboard (W-038)', () => {
  it('is a menu of menuitems and focuses the first item on open', () => {
    const { items } = open();
    expect(items.length).toBe(3);
    expect(document.activeElement).toBe(items[0]);
  });

  it('ArrowDown/ArrowUp move between items and wrap; Home/End jump', () => {
    const { menu, items } = open();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
  });
});
