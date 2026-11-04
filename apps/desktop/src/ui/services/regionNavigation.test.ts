import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cycleRegion, focusRegion, listRegions, installRegionNavigation } from './regionNavigation';

const always = () => true;
let off: () => void;

beforeEach(() => {
  document.body.innerHTML = `
    <header data-kth-region="header"><input id="q"></header>
    <nav class="app-rail"><button id="r1">One</button><button id="r2" aria-current="page">Two</button></nav>
    <div data-kth-region="pane" data-panel-id="p1" role="region" aria-label="Bible"><h2 data-pane-focus tabindex="-1" id="h">Romans</h2><button id="b1">x</button></div>
    <div data-kth-region="pane" data-panel-id="p2" role="region" aria-label="Notes"><button id="n1">n</button></div>
    <footer data-kth-region="status" role="status"><span>s</span></footer>`;
  off = installRegionNavigation(document);
});
afterEach(() => off());

const active = () => document.activeElement?.id;
const f6 = (shiftKey = false) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F6', shiftKey, bubbles: true, cancelable: true }));

describe('region navigation (B-113)', () => {
  it('lists header, rail, panes, status in order and skips hidden/inert/modal ones', () => {
    document.querySelector('[data-panel-id=p2]')!.setAttribute('hidden', '');
    expect(listRegions(document, always).map((r) => r.getAttribute('data-kth-region') ?? 'rail'))
      .toEqual(['header', 'rail', 'pane', 'status']);
  });

  it('cycles forwards, wraps, and Shift+F6 goes back; from body F6 starts at the header', () => {
    (document.activeElement as HTMLElement | null)?.blur();
    cycleRegion(1, document, always);
    expect(active()).toBe('q');
    cycleRegion(1, document, always);
    expect(active()).toBe('r2'); // rail: current item
    cycleRegion(1, document, always);
    expect(active()).toBe('h'); // pane: data-pane-focus
    cycleRegion(-1, document, always);
    expect(active()).toBe('r2');
    document.getElementById('q')!.focus();
    cycleRegion(-1, document, always); // wraps to status (no tabbable -> region itself)
    expect(document.activeElement?.getAttribute('data-kth-region')).toBe('status');
  });

  it('returns to the remembered element in a pane', () => {
    document.getElementById('b1')!.focus();
    document.getElementById('n1')!.focus();
    focusRegion(document.querySelector<HTMLElement>('[data-panel-id=p1]')!);
    expect(active()).toBe('b1');
  });

  it('is a no-op while a modal dialog is open', () => {
    document.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-modal="true"></div>');
    document.getElementById('q')!.focus();
    cycleRegion(1, document, always);
    expect(active()).toBe('q');
  });

  it('F6 on the window moves focus even from inside an input', () => {
    document.getElementById('q')!.focus();
    // jsdom has no layout, so visibility defaults reject everything: stub rects.
    document.querySelectorAll<HTMLElement>('[data-kth-region],nav').forEach((el) => {
      el.getBoundingClientRect = () => ({ width: 10, height: 10 }) as DOMRect;
    });
    f6();
    expect(active()).toBe('r2');
    f6(true);
    expect(active()).toBe('q');
  });

  it('rescue: a removed focused button sends focus to its region, not body', async () => {
    const b = document.getElementById('b1')!;
    b.focus();
    b.remove();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.id).toBe('h');
  });

  it('rescue: when the whole pane closed, focus falls back to another pane', async () => {
    document.querySelector('[data-panel-id=p2]')!.setAttribute('data-tour-pane', 'search');
    document.querySelector('[data-panel-id=p1]')!.setAttribute('data-tour-pane', 'bible');
    document.getElementById('n1')!.focus();
    document.querySelector('[data-panel-id=p2]')!.remove();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(document.activeElement?.id).toBe('h');
  });

  it('B-158: a rescue ignores the F6 memory (stale marker) and lands on the pane heading', () => {
    document.getElementById('b1')!.focus(); // remembered for the pane
    (document.activeElement as HTMLElement).blur();
    focusRegion(document.querySelector('[data-panel-id=p1]') as HTMLElement, true);
    expect(active()).toBe('h');
  });

  it('B-113: a rescue never drops focus into the search box', () => {
    document.querySelector('[data-kth-region=header]')!.insertAdjacentHTML('afterbegin', '<button id="logo">Home</button>');
    focusRegion(document.querySelector('[data-kth-region=header]') as HTMLElement, true);
    expect(active()).not.toBe('q');
  });

  it('B-113: removing the focused menu item returns focus to its trigger, not the search box', async () => {
    document.querySelector('[data-kth-region=header]')!.insertAdjacentHTML('beforeend', '<button id="lay">Layout</button><div id="menu"><button id="pre">Preset</button></div>');
    document.getElementById('lay')!.focus();
    document.getElementById('pre')!.focus();
    document.getElementById('menu')!.remove();
    await new Promise((r) => setTimeout(r, 80));
    expect(active()).toBe('lay');
  });
});
