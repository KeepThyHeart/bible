/**
 * Component tests for ContextMenuPopup.
 *
 * Pattern: Pure presentational component with props and click handlers.
 * No store integration — tests verify rendering and action callbacks.
 *
 * The menu used to carry one entry per study target (Cross-references, Topics,
 * Commentary, Dictionary), each of which opened a pane still showing the
 * previously selected verse. They are now one "Study" entry, and these tests
 * assert the removal so the old entries cannot quietly come back.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

import { ContextMenuPopup } from './ContextMenuPopup';

function renderMenu(overrides: Partial<Parameters<typeof ContextMenuPopup>[0]> = {}) {
  const onAction = vi.fn();
  const menuRef = { current: null };
  const utils = render(
    <ContextMenuPopup
      x={100}
      y={200}
      menuRef={menuRef}
      onAction={onAction}
      {...overrides}
    />,
  );
  return { ...utils, onAction };
}

describe('ContextMenuPopup', () => {
  it('renders the menu container with correct position style', () => {
    const { container } = renderMenu({ x: 50, y: 80 });
    const menu = container.querySelector('.verse-context-menu') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(menu.style.top).toBe('80px');
    expect(menu.style.left).toBe('50px');
  });

  it('renders the copy and study actions', () => {
    renderMenu();
    expect(screen.getByText('contextMenu.copyPassage')).toBeTruthy();
    expect(screen.getByText('contextMenu.study')).toBeTruthy();
  });

  it.each([
    'contextMenu.crossReferences',
    'contextMenu.topics',
    'contextMenu.commentary',
    'contextMenu.dictionary',
  ])('no longer offers %s — the Study entry covers it', (label) => {
    renderMenu();
    expect(screen.queryByText(label)).toBeNull();
  });

  it('calls onAction with "copy" when copy button is clicked', () => {
    const { onAction } = renderMenu();
    fireEvent.click(screen.getByText('contextMenu.copyPassage'));
    expect(onAction).toHaveBeenCalledWith('copy');
  });

  it('calls onAction with "study" when the Study button is clicked', () => {
    const { onAction } = renderMenu();
    fireEvent.click(screen.getByText('contextMenu.study'));
    expect(onAction).toHaveBeenCalledWith('study');
  });

  it('renders a divider between the copy action and the study action', () => {
    const { container } = renderMenu();
    const dividers = container.querySelectorAll('.verse-context-menu__divider');
    expect(dividers.length).toBe(1);
  });
});
