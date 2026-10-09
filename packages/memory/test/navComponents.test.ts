/**
 * @vitest-environment jsdom
 *
 * Tests for the navigation components in `src/ui/components.ts`: `icon()`,
 * `breadcrumb()`, `menu()` / `attachMenuKeys`, and `tabs()` / `attachTabKeys`.
 * Component-level only (DOM and keyboard behaviour); the screens that use
 * them are covered in `panelRender.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  attachMenuKeys,
  attachTabKeys,
  breadcrumb,
  icon,
  menu,
  tabs,
} from '../src/ui/components';
import type { Crumb, IconName } from '../src/ui/components';

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  document.body.innerHTML = '';
});

/** Visible/spoken text of a node: skips `aria-hidden` subtrees, collapses whitespace. */
function spokenText(node: Node): string {
  const parts: string[] = [];
  const walk = (current: Node): void => {
    if (current.nodeType === Node.TEXT_NODE) {
      parts.push(current.nodeValue ?? '');
      return;
    }
    if (current.nodeType !== Node.ELEMENT_NODE) return;
    const element = current as Element;
    if (element.getAttribute('aria-hidden') === 'true') return;
    for (const child of Array.from(element.childNodes)) walk(child);
  };
  walk(node);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

function key(el: Element, k: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}

describe('icon()', () => {
  const NAMES: IconName[] = [
    'home',
    'menu',
    'variety',
    'refmatch',
    'ordering',
    'blanks',
    'firstletters',
    'refprovide',
  ];

  it('builds a real, namespaced <svg> rather than an HTML element', () => {
    const svg = icon('home');
    expect(svg.tagName).toBe('svg');
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
  });

  it('is decorative - aria-hidden, with no accessible name of its own', () => {
    for (const name of NAMES) {
      const svg = icon(name);
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('role')).not.toBe('img');
      expect(svg.hasAttribute('aria-label')).toBe(false);
    }
  });

  it('takes its colour from the surrounding text rather than a fixed one', () => {
    for (const name of NAMES) {
      expect(icon(name).getAttribute('stroke')).toBe('currentColor');
    }
  });

  it('shares one viewBox and stroke width across every name', () => {
    for (const name of NAMES) {
      const svg = icon(name);
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg.getAttribute('stroke-width')).toBe('2');
      // Line icons only - a filled icon here would look like a different set
      // the moment it sat next to the other seven.
      expect(svg.getAttribute('fill')).toBe('none');
    }
  });

  it('draws something - every name renders at least one path', () => {
    for (const name of NAMES) {
      const paths = icon(name).querySelectorAll('path');
      expect(paths.length).toBeGreaterThan(0);
      for (const path of Array.from(paths)) {
        expect(path.getAttribute('d')).toBeTruthy();
      }
    }
  });

  it('draws a different icon for every name - none share their path data', () => {
    const signatures = NAMES.map((name) =>
      Array.from(icon(name).querySelectorAll('path'))
        .map((p) => p.getAttribute('d'))
        .join('|'),
    );
    expect(new Set(signatures).size).toBe(NAMES.length);
  });

  it('renders fresh, unshared nodes on every call', () => {
    const a = icon('menu');
    const b = icon('menu');
    expect(a).not.toBe(b);
    a.setAttribute('data-marker', 'x');
    expect(b.hasAttribute('data-marker')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. breadcrumb() - replaces the old toolbar()'s back arrow
// ---------------------------------------------------------------------------

describe('breadcrumb()', () => {
  it('renders a nav landmark labelled Breadcrumb, holding an ordered list', () => {
    const trail = breadcrumb({ crumbs: [{ label: 'Home', onClick: () => {} }, { label: 'Settings' }] });
    container.appendChild(trail);

    expect(trail.tagName).toBe('NAV');
    expect(trail.classList.contains('sm-crumbs')).toBe(true);
    expect(trail.getAttribute('aria-label')).toBe('Breadcrumb');
    expect(trail.querySelector('ol')).not.toBeNull();
  });

  it('renders the final crumb as the screen\'s own <h1>, marked current', () => {
    const trail = breadcrumb({ crumbs: [{ label: 'Home', onClick: () => {} }, { label: 'Analytics' }] });
    container.appendChild(trail);

    const current = trail.querySelector('h1')!;
    expect(current).not.toBeNull();
    expect(current.classList.contains('sm-crumb-current')).toBe(true);
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(spokenText(current)).toBe('Analytics');

    // Exactly one - a second `<h1>` would break `panel.ts#render`'s
    // "focus `main.querySelector('h1')`" contract.
    expect(trail.querySelectorAll('h1').length).toBe(1);
  });

  it('renders every non-final crumb as a real <button>, and clicking one navigates', () => {
    const clicked: string[] = [];
    const crumbs: Crumb[] = [
      { label: 'Home', onClick: () => clicked.push('Home') },
      { label: 'Middle', onClick: () => clicked.push('Middle') },
      { label: 'Current' },
    ];
    const trail = breadcrumb({ crumbs });
    container.appendChild(trail);

    const buttons = Array.from(trail.querySelectorAll<HTMLButtonElement>('button.sm-crumb'));
    expect(buttons.length).toBe(2);
    expect(buttons.every((b) => b.type === 'button')).toBe(true);
    expect(spokenText(buttons[1]!)).toBe('Middle');

    buttons[1]!.click();
    expect(clicked).toEqual(['Middle']);

    buttons[0]!.click();
    expect(clicked).toEqual(['Middle', 'Home']);

    // The final crumb is never itself a button - there is nowhere further to
    // go from the current screen.
    expect(trail.querySelector('h1')!.tagName).not.toBe('BUTTON');
  });

  it('draws crumb 1 as a house glyph plus the word "Home", whether or not it is also the final crumb', () => {
    const linked = breadcrumb({ crumbs: [{ label: 'Home', onClick: () => {} }, { label: 'Settings' }] });
    const homeCrumb = linked.querySelector('.sm-crumb')!;
    expect(homeCrumb.querySelector('svg.sm-icon-home')).not.toBeNull();
    expect(spokenText(homeCrumb)).toBe('Home');

    // The home screen itself: a single crumb that is both crumb 1 and final.
    const sole = breadcrumb({ crumbs: [{ label: 'Home' }] });
    const heading = sole.querySelector('h1')!;
    expect(heading.querySelector('svg.sm-icon-home')).not.toBeNull();
    expect(spokenText(heading)).toBe('Home');
    expect(heading.getAttribute('aria-current')).toBe('page');
  });

  it('separates crumbs with a "›", hidden from assistive tech', () => {
    const trail = breadcrumb({ crumbs: [{ label: 'Home', onClick: () => {} }, { label: 'Settings' }] });
    container.appendChild(trail);

    const sep = trail.querySelector('.sm-crumb-sep')!;
    expect(sep.textContent).toBe('›');
    expect(sep.querySelector('[aria-hidden="true"]')).not.toBeNull();
    // The accessible name of the whole trail skips it entirely.
    expect(spokenText(trail)).not.toContain('›');
  });

  it('places an optional menu slot and action elements where given', () => {
    const menuSlot = document.createElement('button');
    menuSlot.textContent = 'Menu';
    const action = document.createElement('button');
    action.textContent = 'Extra';

    const trail = breadcrumb({ crumbs: [{ label: 'Home' }], menu: menuSlot, actions: [action] });

    expect(trail.contains(menuSlot)).toBe(true);
    expect(trail.contains(action)).toBe(true);
  });

  it('leaves the menu slot out entirely when not given, as every current call site does', () => {
    const trail = breadcrumb({ crumbs: [{ label: 'Home' }] });
    // Nothing beyond the crumb list and the (empty) actions slot.
    expect(trail.children.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 9b. menu() - the hamburger that fills breadcrumb()'s menu slot (M3)
// ---------------------------------------------------------------------------

describe('menu()', () => {
  function threeItemMenu(): { el: HTMLElement; clicked: string[] } {
    const clicked: string[] = [];
    const el = menu({
      label: 'Menu',
      items: [
        { label: 'Manage Passages', onClick: () => clicked.push('Manage Passages') },
        { label: 'Analytics', onClick: () => clicked.push('Analytics') },
        { label: 'Settings', onClick: () => clicked.push('Settings') },
      ],
    });
    return { el, clicked };
  }

  function trigger(root: HTMLElement): HTMLButtonElement {
    return root.querySelector<HTMLButtonElement>('.sm-menu-btn')!;
  }

  function panel(root: HTMLElement): HTMLElement {
    return root.querySelector<HTMLElement>('[role="menu"]')!;
  }

  function menuItems(root: HTMLElement): HTMLButtonElement[] {
    return Array.from(root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
  }

  it('renders a trigger with aria-haspopup and aria-expanded="false", closed by default', () => {
    const { el } = threeItemMenu();
    container.appendChild(el);

    const btn = trigger(el);
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.type).toBe('button');
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(panel(el).hidden).toBe(true);
  });

  it('clicking the trigger opens the menu with all three items, in order, and flips aria-expanded', () => {
    const { el } = threeItemMenu();
    container.appendChild(el);

    trigger(el).click();

    expect(trigger(el).getAttribute('aria-expanded')).toBe('true');
    expect(panel(el).hidden).toBe(false);
    expect(menuItems(el).map(spokenText)).toEqual(['Manage Passages', 'Analytics', 'Settings']);
    expect(menuItems(el).every((b) => b.getAttribute('role') === 'menuitem')).toBe(true);
  });

  it('clicking the trigger again closes it', () => {
    const { el } = threeItemMenu();
    container.appendChild(el);

    trigger(el).click();
    trigger(el).click();

    expect(trigger(el).getAttribute('aria-expanded')).toBe('false');
    expect(panel(el).hidden).toBe(true);
  });

  it.each([
    ['Manage Passages', 0],
    ['Analytics', 1],
    ['Settings', 2],
  ])('clicking "%s" calls its onClick and closes the menu', (label, index) => {
    const { el, clicked } = threeItemMenu();
    container.appendChild(el);

    trigger(el).click();
    menuItems(el)[index]!.click();

    expect(clicked).toEqual([label]);
    expect(panel(el).hidden).toBe(true);
    expect(trigger(el).getAttribute('aria-expanded')).toBe('false');
  });

  it('Escape closes the menu and returns focus to the trigger', () => {
    const { el } = threeItemMenu();
    container.appendChild(el);

    trigger(el).click();
    expect(document.activeElement).toBe(menuItems(el)[0]);

    menuItems(el)[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(panel(el).hidden).toBe(true);
    expect(trigger(el).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger(el));
  });

  it('a pointerdown outside the menu (and its trigger) closes it', () => {
    const { el } = threeItemMenu();
    container.appendChild(el);
    const outside = document.createElement('div');
    container.appendChild(outside);

    trigger(el).click();
    expect(panel(el).hidden).toBe(false);

    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(panel(el).hidden).toBe(true);
    expect(trigger(el).getAttribute('aria-expanded')).toBe('false');
  });

  it('a pointerdown on an item inside the menu does not close it via the outside handler', () => {
    const { el } = threeItemMenu();
    container.appendChild(el);

    trigger(el).click();
    menuItems(el)[1]!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    // Still open - only the item's own click handler (tested above) closes
    // the menu when an item is the target, not the outside-pointerdown path.
    expect(panel(el).hidden).toBe(false);
  });

  it('Down moves focus to the next item and wraps from the last back to the first', () => {
    const { el } = threeItemMenu();
    container.appendChild(el);

    trigger(el).click();
    const items = menuItems(el);
    expect(document.activeElement).toBe(items[0]);

    items[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[1]);

    items[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[2]);

    items[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[0]);
  });

  it('Up moves focus to the previous item and wraps from the first back to the last', () => {
    const { el } = threeItemMenu();
    container.appendChild(el);

    trigger(el).click();
    const items = menuItems(el);

    items[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(items[2]);

    items[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(items[1]);
  });

  it('keeps a roving tabindex: only the focused item sits in the page Tab order', () => {
    const { el } = threeItemMenu();
    container.appendChild(el);

    trigger(el).click();
    const items = menuItems(el);
    expect(items.map((b) => b.tabIndex)).toEqual([0, -1, -1]);

    items[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(items.map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
  });
});


// ---------------------------------------------------------------------------
// tabs()
// ---------------------------------------------------------------------------

describe('tabs()', () => {
  const ITEMS = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
    { value: 'c', label: 'Gamma' },
  ] as const;

  function build(selected: 'a' | 'b' | 'c', onSelect: (v: string) => void = () => {}) {
    const strip = tabs({ items: ITEMS, selected, onSelect, ariaLabel: 'Letters' });
    container.appendChild(strip);
    return { strip, buttons: Array.from(strip.querySelectorAll<HTMLButtonElement>('[role="tab"]')) };
  }

  it('renders a labelled tablist of tab buttons with the selected one marked', () => {
    const { strip, buttons } = build('b');
    expect(strip.getAttribute('role')).toBe('tablist');
    expect(strip.getAttribute('aria-label')).toBe('Letters');
    expect(buttons.map(spokenText)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(buttons.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(buttons.map((t) => t.classList.contains('sm-tab-selected'))).toEqual([false, true, false]);
    expect(buttons.every((t) => t.type === 'button')).toBe(true);
  });

  it('omits aria-label when none is given', () => {
    const strip = tabs({ items: ITEMS, selected: 'a', onSelect: () => {} });
    expect(strip.hasAttribute('aria-label')).toBe(false);
  });

  it('calls onSelect with the pressed tab value', () => {
    const picked: string[] = [];
    const { buttons } = build('a', (v) => picked.push(v));
    buttons[2]!.click();
    expect(picked).toEqual(['c']);
  });

  it('puts only the selected tab in the Tab order', () => {
    const { buttons } = build('b');
    expect(buttons.map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('moves focus (not selection) with Left/Right/Home/End, wrapping, and rolls tabindex', () => {
    const picked: string[] = [];
    const { buttons } = build('b', (v) => picked.push(v));

    buttons[1]!.focus();
    key(buttons[1]!, 'ArrowRight');
    expect(document.activeElement).toBe(buttons[2]);
    expect(buttons.map((t) => t.tabIndex)).toEqual([-1, -1, 0]);

    key(buttons[2]!, 'ArrowRight');
    expect(document.activeElement).toBe(buttons[0]); // wraps forward

    key(buttons[0]!, 'ArrowLeft');
    expect(document.activeElement).toBe(buttons[2]); // wraps back

    key(buttons[2]!, 'Home');
    expect(document.activeElement).toBe(buttons[0]);
    key(buttons[0]!, 'End');
    expect(document.activeElement).toBe(buttons[2]);

    expect(picked).toEqual([]);
  });

  it('ignores unrelated keys and does not throw on an empty strip', () => {
    const { buttons } = build('a');
    buttons[0]!.focus();
    const ev = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true });
    buttons[0]!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(buttons[0]);

    const empty = tabs({ items: [], selected: 'a' as never, onSelect: () => {} });
    expect(empty.querySelectorAll('[role="tab"]').length).toBe(0);
  });

  it('exports attachTabKeys for callers that build their own strip', () => {
    const list = document.createElement('div');
    const one = document.createElement('button');
    const two = document.createElement('button');
    list.append(one, two);
    container.appendChild(list);
    attachTabKeys(list, [one, two]);
    one.focus();
    key(one, 'ArrowRight');
    expect(document.activeElement).toBe(two);
  });
});

describe('attachMenuKeys()', () => {
  it('moves focus with Up/Down, wraps, and calls onEscape', () => {
    const panel = document.createElement('div');
    const a = document.createElement('button');
    const b = document.createElement('button');
    panel.append(a, b);
    container.appendChild(panel);
    const roving: number[] = [];
    let escaped = 0;
    attachMenuKeys(panel, [a, b], (i) => roving.push(i), () => escaped++);

    a.focus();
    key(a, 'ArrowDown');
    expect(document.activeElement).toBe(b);
    key(b, 'ArrowDown');
    expect(document.activeElement).toBe(a);
    key(a, 'ArrowUp');
    expect(document.activeElement).toBe(b);
    expect(roving).toEqual([1, 0, 1]);

    key(b, 'Escape');
    expect(escaped).toBe(1);
  });
});
