import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: { defaultValue?: string }) => (o && typeof o === 'object' && o.defaultValue) || key }),
}));

import { ServiceMenu } from './ServiceMenu';
import type { Service, ServiceStore } from './serviceStore';

const svc = (id: string, name: string, date: string) => ({ id, name, date, doc: { type: 'doc', content: [] } }) as unknown as Service;

function fakeStore(list: Service[]): ServiceStore {
  return {
    ready: async () => {},
    subscribe: () => () => {},
    list: () => list,
    get: (id: string) => list.find((s) => s.id === id),
    open: (id: string) => list.find((s) => s.id === id),
    flush: async () => {},
    persistent: true,
  } as unknown as ServiceStore;
}

// 0209 R2 W7 items 3 and 7: the service menu has distinct item names, only menuitems inside the menu, and Escape returns focus.
describe('ServiceMenu', () => {
  const store = fakeStore([svc('a', '2026-11-04', '2026-11-04'), svc('b', 'Easter', '2026-04-05')]);

  const open = async () => {
    const view = render(<ServiceMenu currentId="a" onSelect={() => {}} store={store} />);
    const trigger = view.container.querySelector<HTMLButtonElement>('.service-menu__trigger')!;
    trigger.focus();
    await act(async () => { fireEvent.click(trigger); });
    return { ...view, trigger };
  };

  it('does not repeat a default (date) name in its menu item', async () => {
    const { container } = await open();
    const first = container.querySelectorAll('.service-menu__open')[0];
    expect(first.textContent).toBe('2026-11-04');
    const second = container.querySelectorAll('.service-menu__open')[1];
    expect(second.textContent).toBe('Easter2026-04-05');
  });

  it('has only menuitems as interactive children, each row action named after its service', async () => {
    const { container } = await open();
    const menu = container.querySelector('[role="menu"]')!;
    const buttons = Array.from(menu.querySelectorAll('button'));
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b.getAttribute('role')).toBe('menuitem');
    const names = buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim());
    expect(new Set(names).size).toBe(names.length);
    expect(names.some((n) => n?.includes('Easter'))).toBe(true);
  });

  it('focuses the first item on open and Escape closes and refocuses the button', async () => {
    const { container, trigger } = await open();
    expect(document.activeElement).toBe(container.querySelector('.service-menu__open'));
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' }); });
    expect(document.activeElement).toBe(container.querySelectorAll('[role="menuitem"]')[1]);
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }); });
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
