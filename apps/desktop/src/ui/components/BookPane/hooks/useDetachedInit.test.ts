/**
 * Unit tests for the Book pane's detached seeding hook.
 *
 * Unlike the Bible pane (which replays a session blob through the store's
 * restore path), this hook rebuilds the panel's per-tab `Map`s by hand from the
 * entry arrays that crossed IPC. That rehydration is the part that breaks
 * quietly: a Map left as an array makes the pane render as though the book has
 * no sections, which looks identical to "the book failed to load".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { updatePanelState } from '../../../stores/helpers/panelStateHelpers';

let storeState: { panels: Map<string, any> };
const setState = vi.fn((partial: any) => {
  storeState = { ...storeState, ...partial };
});

vi.mock('../../../stores/useBookStore', () => ({
  useBookStore: {
    getState: () => storeState,
    setState: (partial: any) => setState(partial),
  },
  // The hook seeds missing panels with the store's real factory, so the mock has
  // to supply it too - otherwise every Map below would come back undefined.
  createDefaultBookPanelState: () => ({
    openTabs: [],
    activeTabIndex: 0,
    currentSectionByTab: new Map(),
    sectionsByTab: new Map(),
    loadingByTab: new Map(),
    errorByTab: new Map(),
    sectionSummariesByTab: new Map(),
    loadingSummariesByTab: new Map(),
    summariesErrorByTab: new Map(),
    childSectionsByTab: new Map(),
  }),
}));

import { useDetachedInit } from './useDetachedInit';

const PANEL = 'detached-1';

const PROPS = {
  isDetached: true,
  panelId: PANEL,
  openTabs: [{ abbreviation: 'book_pp', name: "Pilgrim's Progress" }] as any,
  activeTabIndex: 0,
  currentSectionByTab: [['book_pp', 12]] as [string, number | null][],
  sectionsByTab: [['book_pp', { section_id: 12, title: 'The Slough of Despond' }]] as any,
  childSectionsByTab: [['book_pp', [{ section_id: 13, title: 'Chapter 2' }]]] as any,
  sectionSummariesByTab: [['book_pp', [{ section_id: 12, title: 'Chapter 1' }]]] as any,
};

/** The panel state the hook wrote. */
function writtenPanel() {
  return storeState.panels.get(PANEL);
}

beforeEach(() => {
  vi.clearAllMocks();
  storeState = { panels: new Map() };
  setState.mockImplementation((partial: any) => {
    storeState = { ...storeState, ...partial };
  });
});

describe('useDetachedInit (Book)', () => {
  it('writes the open tabs into the panel', () => {
    renderHook(() => useDetachedInit(PROPS));

    expect(setState).toHaveBeenCalledTimes(1);
    expect(writtenPanel().openTabs).toEqual(PROPS.openTabs);
    expect(writtenPanel().activeTabIndex).toBe(0);
  });

  it('rehydrates the serialized entry arrays back into Maps', () => {
    renderHook(() => useDetachedInit(PROPS));
    const panel = writtenPanel();

    expect(panel.currentSectionByTab).toBeInstanceOf(Map);
    expect(panel.currentSectionByTab.get('book_pp')).toBe(12);
    expect(panel.sectionsByTab).toBeInstanceOf(Map);
    expect(panel.sectionsByTab.get('book_pp')).toEqual({ section_id: 12, title: 'The Slough of Despond' });
    expect(panel.childSectionsByTab).toBeInstanceOf(Map);
    expect(panel.childSectionsByTab.get('book_pp')).toEqual([{ section_id: 13, title: 'Chapter 2' }]);
    expect(panel.sectionSummariesByTab).toBeInstanceOf(Map);
    expect(panel.sectionSummariesByTab.get('book_pp')).toEqual([{ section_id: 12, title: 'Chapter 1' }]);
  });

  it('leaves the remaining per-tab Maps present and empty', () => {
    // The pane reads loadingByTab/errorByTab unconditionally; a missing Map
    // here is a TypeError on first render of the detached window.
    renderHook(() => useDetachedInit(PROPS));
    const panel = writtenPanel();

    expect(panel.loadingByTab).toBeInstanceOf(Map);
    expect(panel.errorByTab).toBeInstanceOf(Map);
    expect(panel.loadingSummariesByTab).toBeInstanceOf(Map);
  });

  it('does nothing in the main window', () => {
    renderHook(() => useDetachedInit({ ...PROPS, isDetached: false }));
    expect(setState).not.toHaveBeenCalled();
  });

  it('does nothing when no tabs were handed over', () => {
    renderHook(() => useDetachedInit({ ...PROPS, openTabs: undefined }));
    expect(setState).not.toHaveBeenCalled();
  });

  it('tolerates missing Map payloads by seeding empty Maps', () => {
    renderHook(() => useDetachedInit({
      isDetached: true,
      panelId: PANEL,
      openTabs: PROPS.openTabs,
      activeTabIndex: 0,
    }));

    const panel = writtenPanel();
    expect(panel.openTabs).toEqual(PROPS.openTabs);
    expect(panel.currentSectionByTab.size).toBe(0);
    expect(panel.sectionsByTab.size).toBe(0);
  });

  it('defaults activeTabIndex to 0 when it is absent', () => {
    renderHook(() => useDetachedInit({ ...PROPS, activeTabIndex: undefined }));
    expect(writtenPanel().activeTabIndex).toBe(0);
  });

  it('seeds only the panel it was given', () => {
    storeState.panels = updatePanelState(
      new Map(),
      'other-panel',
      { openTabs: [{ abbreviation: 'book_other', name: 'Other' }] } as any,
      () => ({}) as any
    );

    renderHook(() => useDetachedInit(PROPS));

    expect(writtenPanel().openTabs).toEqual(PROPS.openTabs);
    expect(storeState.panels.get('other-panel').openTabs)
      .toEqual([{ abbreviation: 'book_other', name: 'Other' }]);
  });

  it('seeds once, not on every re-render', () => {
    const { rerender } = renderHook((props) => useDetachedInit(props), { initialProps: PROPS });
    rerender({ ...PROPS });
    rerender({ ...PROPS });

    expect(setState).toHaveBeenCalledTimes(1);
  });
});
