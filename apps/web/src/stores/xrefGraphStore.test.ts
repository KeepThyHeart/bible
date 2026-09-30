import { describe, it, expect, beforeEach, vi } from 'vitest';
import { xrefGraphStore } from './xrefGraphStore';

beforeEach(() => {
  xrefGraphStore.close();
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
});

describe('xrefGraphStore', () => {
  it('opens on an anchor and notifies', () => {
    const fn = vi.fn();
    const off = xrefGraphStore.subscribe(fn);
    xrefGraphStore.open(43003016);
    expect(xrefGraphStore.isOpen).toBe(true);
    expect(xrefGraphStore.anchor).toBe(43003016);
    expect(fn).toHaveBeenCalled();
    off();
  });

  it('defaults to web on wide and hopper on narrow viewports', () => {
    xrefGraphStore.open(1001001);
    expect(xrefGraphStore.view).toBe('web');
    xrefGraphStore.close();
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
    xrefGraphStore.open(1001001);
    expect(xrefGraphStore.view).toBe('hopper');
  });

  it('remembers the last view set', () => {
    xrefGraphStore.open(1001001);
    xrefGraphStore.setView('arcs');
    xrefGraphStore.close();
    xrefGraphStore.open(1001002);
    expect(xrefGraphStore.view).toBe('arcs');
    expect(localStorage.getItem('bible-reader-xref-graph-view')).toBe('arcs');
  });

  it('open with an explicit view uses and remembers it', () => {
    xrefGraphStore.open(1001001, 'hopper');
    expect(xrefGraphStore.view).toBe('hopper');
    xrefGraphStore.close();
    xrefGraphStore.open(1001001);
    expect(xrefGraphStore.view).toBe('hopper');
  });

  it('setAnchor updates the anchor and close clears isOpen', () => {
    xrefGraphStore.open(1001001);
    xrefGraphStore.setAnchor(2002002);
    expect(xrefGraphStore.anchor).toBe(2002002);
    xrefGraphStore.close();
    expect(xrefGraphStore.isOpen).toBe(false);
  });

  it('works when localStorage throws', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('x'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('x'); });
    expect(() => { xrefGraphStore.open(1001001); xrefGraphStore.setView('arcs'); }).not.toThrow();
    expect(xrefGraphStore.view).toBe('arcs');
    get.mockRestore(); set.mockRestore();
  });
});
