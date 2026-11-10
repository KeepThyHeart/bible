import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/preact';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./sections', () => ({
  ScreenSection: () => <section><h2>Screen</h2></section>,
  JoinSection: () => null,
  HandoffSection: () => null,
}));
vi.mock('../../stores/presentStore', () => ({ presentStore: { leave: vi.fn() } }));

import { ControlMenu } from './ControlMenu';

// 0209 R2 W7 item 2: the settings popover holds headings, checkboxes and links, so it is a dialog, not a menu.
describe('ControlMenu', () => {
  it('is a named non-modal dialog', () => {
    render(<ControlMenu session={null} onClose={() => {}} onOpenHelp={() => {}} />);
    const dialog = document.querySelector('.pz-menu')!;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-label')).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBeNull();
  });

  it('Escape closes it and returns focus to its button', () => {
    const toggle = document.createElement('button');
    toggle.setAttribute('data-control-menu-toggle', '');
    document.body.appendChild(toggle);
    const onClose = vi.fn();
    render(<ControlMenu session={null} onClose={onClose} onOpenHelp={() => {}} />);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(toggle);
    toggle.remove();
  });

  it('leaves Escape to an open "About remote keys" popover (innermost layer first)', () => {
    const pop = document.createElement('div');
    pop.className = 'pz-helptip__pop';
    document.body.appendChild(pop);
    const onClose = vi.fn();
    render(<ControlMenu session={null} onClose={onClose} onOpenHelp={() => {}} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    pop.remove();
  });

  it('a press inside that popover (portalled out of the dialog) does not close the dialog', async () => {
    const pop = document.createElement('div');
    pop.className = 'pz-helptip__pop';
    document.body.appendChild(pop);
    const onClose = vi.fn();
    render(<ControlMenu session={null} onClose={onClose} onOpenHelp={() => {}} />);
    await act(async () => { pop.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(1);
    pop.remove();
  });
});
