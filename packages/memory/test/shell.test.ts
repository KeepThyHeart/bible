// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlanView } from '../src/core/types';
import type { PanelHost } from '../src/ui/host';
import { appShell, focusedHeader } from '../src/ui/shell';

function host(over: Record<string, unknown> = {}) {
  return { go: vi.fn(), reload: vi.fn(), announce: vi.fn(), request: vi.fn(async () => ({ ok: true, data: {} })), fail: vi.fn(), ...over } as unknown as PanelHost & {
    go: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
    reload: ReturnType<typeof vi.fn>;
    announce: ReturnType<typeof vi.fn>;
  };
}
const plan = (scope: 'all' | number): PlanView =>
  ({ scope, collectionName: 'Fallback', lists: [{ id: 3, name: 'Psalms' }] }) as unknown as PlanView;
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('appShell', () => {
  it('builds a tablist with roving tabindex and a labelled tabpanel', () => {
    const root = appShell(host(), 'verses', null, document.createElement('p'));
    document.body.appendChild(root);
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
    expect(root.querySelector('[role="tablist"]')).not.toBeNull();
    expect(root.querySelector('[role="tabpanel"]')!.getAttribute('aria-labelledby')).toBe(tabs[1]!.id);
    expect(root.querySelector('[role="tabpanel"] p')).not.toBeNull();
  });

  it('arrow keys move focus without selecting; click selects', () => {
    const h = host();
    const root = appShell(h, 'today', null, document.createElement('div'));
    document.body.appendChild(root);
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    tabs[0]!.focus();
    key(tabs[0]!, 'ArrowRight');
    expect(document.activeElement).toBe(tabs[1]);
    expect(h.go).not.toHaveBeenCalled();
    tabs[1]!.click();
    expect(h.go).toHaveBeenCalledWith({ type: 'goTab', tab: 'verses' });
  });

  it('gear opens settings; on settings no tab is selected and the gear is current', () => {
    const h = host();
    const normal = appShell(h, 'today', null, document.createElement('div'));
    normal.querySelector<HTMLElement>('.sm-shell-gear')!.click();
    expect(h.go).toHaveBeenCalledWith({ type: 'goSettings' });
    expect(normal.querySelector('.sm-shell-gear')!.hasAttribute('aria-current')).toBe(false);

    const settings = appShell(h, 'settings', null, document.createElement('div'));
    expect(settings.querySelector('.sm-shell-gear')!.getAttribute('aria-current')).toBe('page');
    const tabs = [...settings.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.every((t) => t.getAttribute('aria-selected') === 'false')).toBe(true);
    expect(tabs.filter((t) => t.tabIndex === 0)).toHaveLength(1);
  });

  it('shows the focus chip only for a scoped plan on Today / My verses', () => {
    const c = document.createElement('div');
    expect(appShell(host(), 'today', plan('all'), c).querySelector('.sm-shell-chip')).toBeNull();
    expect(appShell(host(), 'progress', plan(3), c).querySelector('.sm-shell-chip')).toBeNull();
    expect(appShell(host(), 'today', null, c).querySelector('.sm-shell-chip')).toBeNull();
    const chip = appShell(host(), 'verses', plan(3), c).querySelector('.sm-shell-chip')!;
    expect(chip.textContent).toContain('Focus: Psalms');
  });

  it('the chip clear button clears the focus like listActions.setFocus: scope all, announce, reload', async () => {
    const h = host();
    const root = appShell(h, 'today', plan(3), document.createElement('div'));
    root.querySelector<HTMLElement>('.sm-shell-chip-clear')!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.request).toHaveBeenCalledWith({ type: 'setScope', scope: { kind: 'all' } });
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.announce).toHaveBeenCalledWith('Today now follows all your lists.');
    expect(h.reload).toHaveBeenCalled();
  });

  it('does not use a menu button or breadcrumbs', () => {
    const root = appShell(host(), 'today', null, document.createElement('div'));
    expect(root.querySelector('.sm-menu, nav[aria-label="Breadcrumb"]')).toBeNull();
  });
});

describe('focusedHeader', () => {
  it('has an h1 title and a labelled close button', () => {
    const onClose = vi.fn();
    const menuEl = document.createElement('span');
    const metaEl = document.createElement('span');
    const head = focusedHeader({ title: 'John 3:16', onClose, closeLabel: 'Close practice', menu: menuEl, meta: metaEl });
    expect(head.querySelector('h1')!.textContent).toBe('John 3:16');
    const close = head.querySelector<HTMLButtonElement>('button')!;
    expect(close.getAttribute('aria-label')).toBe('Close practice');
    close.click();
    expect(onClose).toHaveBeenCalled();
    expect(head.contains(menuEl)).toBe(true);
    expect(head.contains(metaEl)).toBe(true);
  });

  it('defaults the close label', () => {
    const head = focusedHeader({ title: 'x', onClose: () => {} });
    expect(head.querySelector('button')!.getAttribute('aria-label')).toBe('Close');
  });
});
