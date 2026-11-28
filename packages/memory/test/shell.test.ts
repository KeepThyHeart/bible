// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlanView } from '../src/core/types';
import type { PanelHost } from '../src/ui/host';
import { createShell, focusedHeader, tabId } from '../src/ui/shell';

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

describe('createShell', () => {
  it('is the shared app-page frame: h1 title, kth tabs, labelled tabpanel', () => {
    const shell = createShell(host());
    const root = shell.root;
    expect(root.classList.contains('kth-app-page')).toBe(true);
    expect(root.querySelector('.kth-app-page__column > .kth-app-page__header > h1.kth-app-page__title')!.textContent).toBe('Memory');
    expect(root.querySelector('h1')!.getAttribute('tabindex')).toBe('-1');
    const list = root.querySelector('[role="tablist"]')!;
    expect(list.classList.contains('kth-tabs')).toBe(true);
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Home', 'Practice', 'My verses', 'Settings']);
    expect(tabs.every((t) => t.classList.contains('kth-tabs__tab'))).toBe(true);
    expect(shell.panel.getAttribute('role')).toBe('tabpanel');
    expect(shell.panel.classList.contains('kth-app-page__body')).toBe(true);
    // Home is selected at first.
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false']);
    expect(shell.panel.getAttribute('aria-labelledby')).toBe(tabId('home'));
    // No gear any more.
    expect(root.querySelector('.sm-shell-gear')).toBeNull();
  });

  it('setTab moves aria-selected, the roving tabindex and the panel label', () => {
    const shell = createShell(host());
    shell.setTab('verses');
    const tabs = [...shell.root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true', 'false']);
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, -1, 0, -1]);
    expect(shell.panel.getAttribute('aria-labelledby')).toBe(tabs[2]!.id);
  });

  it('takes a title and actions for the title row', () => {
    const onClick = vi.fn();
    const shell = createShell(host(), { title: 'Scripture Memory', actions: [{ label: 'Back to Study', onClick }] });
    expect(shell.root.querySelector('h1')!.textContent).toBe('Scripture Memory');
    const btn = shell.root.querySelector<HTMLButtonElement>('.kth-app-page__actions button')!;
    expect(btn.textContent).toBe('Back to Study');
    btn.click();
    expect(onClick).toHaveBeenCalled();
    expect(createShell(host()).root.querySelector('.kth-app-page__actions')).toBeNull();
  });

  it('arrow keys move focus without selecting; click selects', () => {
    const h = host();
    const shell = createShell(h);
    document.body.appendChild(shell.root);
    const tabs = [...shell.root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    tabs[0]!.focus();
    key(tabs[0]!, 'ArrowRight');
    expect(document.activeElement).toBe(tabs[1]);
    expect(h.go).not.toHaveBeenCalled();
    tabs[2]!.click();
    expect(h.go).toHaveBeenCalledWith({ type: 'goTab', tab: 'verses' });
    tabs[3]!.click();
    expect(h.go).toHaveBeenCalledWith({ type: 'goTab', tab: 'settings' });
  });

  it('setContent fills the panel; null leaves it empty and aria-busy', () => {
    const shell = createShell(host());
    shell.setContent(null);
    expect(shell.panel.getAttribute('aria-busy')).toBe('true');
    expect(shell.panel.children).toHaveLength(0);
    const p = document.createElement('p');
    shell.setContent(p);
    expect(shell.panel.hasAttribute('aria-busy')).toBe(false);
    expect(shell.panel.firstElementChild).toBe(p);
    const q = document.createElement('p');
    shell.setContent(q);
    expect([...shell.panel.children]).toEqual([q]);
  });

  it('the focus chip shows only for a scoped plan', () => {
    const shell = createShell(host());
    shell.setChip(plan('all'));
    expect(shell.root.querySelector('.sm-shell-chip')).toBeNull();
    shell.setChip(plan(3));
    expect(shell.root.querySelector('.sm-shell-chip')!.textContent).toContain('Focus: Psalms');
    shell.setChip(null);
    expect(shell.root.querySelector('.sm-shell-chip')).toBeNull();
  });

  it('the chip clear button clears the focus like listActions.setFocus: scope all, announce, reload', async () => {
    const h = host();
    const shell = createShell(h);
    shell.setChip(plan(3));
    shell.root.querySelector<HTMLElement>('.sm-shell-chip-clear')!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.request).toHaveBeenCalledWith({ type: 'setScope', scope: { kind: 'all' } });
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.announce).toHaveBeenCalledWith('Practice now follows all your lists.');
    expect(h.reload).toHaveBeenCalled();
  });

  it('does not use a menu button or breadcrumbs', () => {
    const shell = createShell(host());
    expect(shell.root.querySelector('.sm-menu, nav[aria-label="Breadcrumb"]')).toBeNull();
  });
});

describe('focusedHeader', () => {
  it('has an h2 title and a labelled close button', () => {
    const onClose = vi.fn();
    const menuEl = document.createElement('span');
    const metaEl = document.createElement('span');
    const head = focusedHeader({ title: 'John 3:16', onClose, closeLabel: 'Close practice', menu: menuEl, meta: metaEl });
    expect(head.querySelector('h1')).toBeNull();
    expect(head.querySelector('h2')!.textContent).toBe('John 3:16');
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
