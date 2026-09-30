import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useXrefGraphStore, XREF_GRAPH_VIEW_STORAGE_KEY } from './useXrefGraphStore';

describe('useXrefGraphStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useXrefGraphStore.setState({ isOpen: false, anchor: null, view: 'web' });
  });

  it('opens on an anchor and closes', () => {
    useXrefGraphStore.getState().openGraph(43003016);
    expect(useXrefGraphStore.getState()).toMatchObject({ isOpen: true, anchor: 43003016 });
    useXrefGraphStore.getState().close();
    expect(useXrefGraphStore.getState().isOpen).toBe(false);
  });

  it('defaults to the verse web on a wide viewport and the hopper on a narrow one', () => {
    const original = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    useXrefGraphStore.getState().openGraph(1001001);
    expect(useXrefGraphStore.getState().view).toBe('web');
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
    useXrefGraphStore.getState().openGraph(1001001);
    expect(useXrefGraphStore.getState().view).toBe('hopper');
    Object.defineProperty(window, 'innerWidth', { value: original, configurable: true });
  });

  it('remembers the last used view', () => {
    useXrefGraphStore.getState().setView('arcs');
    expect(window.localStorage.getItem(XREF_GRAPH_VIEW_STORAGE_KEY)).toBe('arcs');
    useXrefGraphStore.getState().close();
    useXrefGraphStore.getState().openGraph(1001001);
    expect(useXrefGraphStore.getState().view).toBe('arcs');
  });

  it('an explicit view wins and setAnchor keeps the dialog open', () => {
    useXrefGraphStore.getState().openGraph(1001001, 'hopper');
    expect(useXrefGraphStore.getState().view).toBe('hopper');
    useXrefGraphStore.getState().setAnchor(2001001);
    expect(useXrefGraphStore.getState()).toMatchObject({ isOpen: true, anchor: 2001001 });
  });

  it('works when localStorage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('no'); });
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('no'); });
    expect(() => useXrefGraphStore.getState().openGraph(1001001)).not.toThrow();
    expect(() => useXrefGraphStore.getState().setView('hopper')).not.toThrow();
    expect(useXrefGraphStore.getState().view).toBe('hopper');
    spy.mockRestore();
    setSpy.mockRestore();
  });
});
