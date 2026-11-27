import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const calls = vi.hoisted(() => ({ range: [] as Array<[number, number, number]>, deleted: [] as number[] }));

vi.mock('../services/highlightsAPI', () => ({
  IPCHighlightRepository: class {
    async getForVerseRange() { return []; }
    async deleteForVerseRange(a: number, b: number, m: number) { calls.range.push([a, b, m]); }
    async delete(id: number) { calls.deleted.push(id); }
  },
}));
vi.mock('../services/announcer', () => ({ announceKey: vi.fn() }));

import { useBibleHighlights } from './useBibleHighlights';
import { useHighlightStore } from '../stores/useHighlightStore';

const TAB = { tabId: 't1', moduleId: 7, abbreviation: 'KJV' } as never;

function setup(root: HTMLDivElement) {
  return renderHook(() => useBibleHighlights(TAB, 43, 3, [], { current: root }));
}

describe('clearing highlights and underlines', () => {
  beforeEach(() => { calls.range.length = 0; calls.deleted.length = 0; });

  it('clears a verse range through the range IPC, lowest verse first', async () => {
    const { result } = setup(document.createElement("div"));
    await act(async () => { await result.current.clearMarksInVerses(43003018, 43003016); });
    expect(calls.range).toEqual([[43003016, 43003018, 7]]);
  });

  it('removes the whole marks under a word selection, every id on a word once', async () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div data-verse-id="43003016">
        <span class="word" data-word-index="0" data-markup-id="5,6">For</span>
        <span class="word" data-word-index="1" data-markup-id="6">God</span>
        <span class="word" data-word-index="9" data-markup-id="8">far</span>
      </div>`;
    const { result } = setup(root);
    const sel = { startVerseId: 43003016, startWordIndex: 0, endVerseId: 43003016, endWordIndex: 1 };
    expect(result.current.selectionHasMarkup(sel as never)).toBe(true);
    await act(async () => { await result.current.removeMarksInWordSelection(sel as never); });
    expect(calls.deleted.sort()).toEqual([5, 6]);
  });

  it('reports no markup for a selection over plain words', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div data-verse-id="43003016"><span class="word" data-word-index="0">For</span></div>';
    const { result } = setup(root);
    expect(result.current.selectionHasMarkup({ startVerseId: 43003016, startWordIndex: 0 } as never)).toBe(false);
  });
});

describe('clearing asks first', () => {
  beforeEach(() => {
    calls.range.length = 0;
    calls.deleted.length = 0;
    useHighlightStore.setState({
      highlightsByModule: new Map([[7, [{ id: 1, verseIdStart: 43003017, verseIdEnd: 43003017 } as never]]]),
    });
  });

  it('Ctrl+Shift+X on verses waits for the confirmation, then clears', async () => {
    const { result } = setup(document.createElement('div'));
    await act(async () => { await result.current.requestClearSelectionMarks(43003016, 43003018); });
    expect(result.current.pendingClear?.scope).toBe('verses');
    expect(calls.range).toEqual([]);
    await act(async () => { result.current.confirmPendingClear(); });
    expect(calls.range).toEqual([[43003016, 43003018, 7]]);
    expect(result.current.pendingClear).toBeNull();
  });

  it('cancelling clears nothing', async () => {
    const { result } = setup(document.createElement('div'));
    await act(async () => { await result.current.requestClearSelectionMarks(43003017, null); });
    expect(result.current.pendingClear?.scope).toBe('verse');
    await act(async () => { result.current.cancelPendingClear(); });
    expect(result.current.pendingClear).toBeNull();
    expect(calls.range).toEqual([]);
  });

  it('asks nothing when the selected verses carry no marks', async () => {
    const { result } = setup(document.createElement('div'));
    await act(async () => { await result.current.requestClearSelectionMarks(43003020, 43003021); });
    expect(result.current.pendingClear).toBeNull();
  });

  it('the verse menu\'s clear for several verses asks too', async () => {
    const { result } = setup(document.createElement('div'));
    await act(async () => { await result.current.requestClearMarksInVerses(43003016, 43003018); });
    expect(result.current.pendingClear?.scope).toBe('verses');
    expect(calls.range).toEqual([]);
  });
});
