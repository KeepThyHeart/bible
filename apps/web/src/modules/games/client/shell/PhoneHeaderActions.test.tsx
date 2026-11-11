// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIGHT_THEME } from '../../shared/theme.js';
import { PhoneHeaderActions } from './PhoneHeaderActions.js';
import type { ThemeControl } from './theme.js';

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  const control: ThemeControl = { theme: LIGHT_THEME, isOverridden: false, setOverride: () => undefined };
  act(() => {
    render(<PhoneHeaderActions code="5HK27" joinUrl="https://x.test/play?room=5HK27" themeControl={control} onLeave={() => undefined} />, host);
  });
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
});

const toggle = () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
const items = () => [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')];

function key(target: Element | null, k: string): void {
  act(() => {
    target?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
}

describe('the "..." menu', () => {
  it('is closed to start with and reports that through aria-expanded', () => {
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it('opens with focus on the first item', () => {
    act(() => toggle().click());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(items().map((item) => item.textContent)).toEqual(['Theme', 'Settings', 'Leave']);
    expect(document.activeElement).toBe(items()[0]);
  });

  it('moves between items with the arrow keys, wrapping at both ends', () => {
    act(() => toggle().click());
    const menu = host.querySelector('[role="menu"]');
    key(menu, 'ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    key(menu, 'End');
    expect(document.activeElement).toBe(items()[2]);
    key(menu, 'ArrowDown');
    expect(document.activeElement).toBe(items()[0]);
    key(menu, 'ArrowUp');
    expect(document.activeElement).toBe(items()[2]);
  });

  it('opens from the keyboard with the down arrow', () => {
    toggle().focus();
    key(toggle(), 'ArrowDown');
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
  });

  it('closes on Escape and hands focus back to the button', () => {
    act(() => toggle().click());
    key(host.querySelector('[role="menu"]'), 'Escape');
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(toggle());
  });

  it('closes when something else is tapped', () => {
    act(() => toggle().click());
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it('closes the menu when an item opens a dialog', () => {
    act(() => toggle().click());
    act(() => items()[1]!.click());
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
