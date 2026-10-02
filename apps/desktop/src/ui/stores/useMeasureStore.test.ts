import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MeasureOccurrence } from '@bible/core/browser';

vi.mock('./helpers/sessionNotifier', () => ({ markSessionDirty: vi.fn() }));
vi.mock('../services/electronAPI', () => ({ bibleAPI: {} }));

import { createMeasureStore } from './useMeasureStore';
import { measureModelsAt } from '../extensions/measureLayer';
import { measureWordAt, wordOf } from '../components/measures/measureWordTarget';

const V = 1006015; // Gen 6:15
const verses = [{ verse_id: V, text_html: 'The length of the ark shall be three hundred cubits' }];
const occ = (status: 'draft' | 'reviewed'): MeasureOccurrence => ({
  id: `${V}.1`, verseId: V, parts: [{ unit: 'cubit', quantity: { value: 300 } }], usage: 'literal', review: { status },
});
const params = (tabId = 'tab-1', surface: 'standard' | 'reading' | 'study' = 'standard') => ({
  tabId, moduleId: 1, abbreviation: 'KJV', language: 'en', bookNumber: 1, chapter: 6, verses, surface, uiLocale: 'en-US',
});

function setup(occurrences: MeasureOccurrence[] = [occ('reviewed')], includeDrafts = false, display: 'off' | 'marker' = 'marker') {
  const loadOccurrences = vi.fn().mockResolvedValue(occurrences);
  const fetchInterlinear = vi.fn().mockResolvedValue({});
  const useStore = createMeasureStore({ loadOccurrences, fetchInterlinear, includeDrafts: () => includeDrafts });
  // The shipped default is 'off' (Study panel only); most tests exercise the in-text marks.
  if (display !== 'off') useStore.setState({ values: { measuresDisplay: display } });
  return { useStore, loadOccurrences, fetchInterlinear };
}

describe('useMeasureStore', () => {
  beforeEach(() => vi.clearAllMocks());

  it('computes the chapter marks and finds them by (verse, word index)', async () => {
    const { useStore, loadOccurrences } = setup();
    useStore.getState().syncChapter(params());
    await vi.waitFor(() => expect(useStore.getState().chapters['tab-1']).toBeDefined());
    expect(loadOccurrences).toHaveBeenCalledWith(1, 6, false);
    const chapter = useStore.getState().chapters['tab-1']!;
    expect(chapter.verseLayers.get(V)?.[0].decorations.length).toBeGreaterThan(0);
    const cubitsIndex = 9; // The length of the ark shall be three hundred cubits
    expect(measureModelsAt(chapter, V, cubitsIndex)[0]?.title).toBe('300 cubits');
    expect(measureModelsAt(chapter, V, 0)).toEqual([]);
    expect(measureModelsAt(undefined, V, cubitsIndex)).toEqual([]);
  });

  it('computes no in-text layer and loads nothing with the default display (off)', async () => {
    const { useStore, loadOccurrences } = setup([occ('reviewed')], false, 'off');
    useStore.getState().syncChapter(params());
    await Promise.resolve();
    expect(useStore.getState().chapters['tab-1']).toBeUndefined();
    expect(loadOccurrences).not.toHaveBeenCalled();
  });

  it('drops draft rows unless drafts are included', async () => {
    const off = setup([occ('draft')], false);
    off.useStore.getState().syncChapter(params());
    await vi.waitFor(() => expect(off.useStore.getState().chapters['tab-1']).toBeDefined());
    expect(off.useStore.getState().chapters['tab-1']!.index.size).toBe(0); // core filters drafts again

    const on = setup([occ('draft')], true);
    on.useStore.getState().syncChapter(params());
    await vi.waitFor(() => expect(on.useStore.getState().chapters['tab-1']?.index.size).toBe(1));
  });

  it('keeps Reading clean unless showInReading, and recomputes when a setting changes', async () => {
    const { useStore } = setup();
    useStore.getState().syncChapter(params('tab-1', 'reading'));
    await vi.waitFor(() => expect(useStore.getState().chapters['tab-1']).toBeDefined());
    expect(useStore.getState().chapters['tab-1']!.verseLayers.size).toBe(0);
    useStore.getState().setValue('measuresShowInReading', true);
    await vi.waitFor(() => expect(useStore.getState().chapters['tab-1']!.verseLayers.size).toBe(1));
    useStore.getState().setValue('measuresEnabled', false);
    await vi.waitFor(() => expect(useStore.getState().chapters['tab-1']).toBeUndefined());
  });

  it('fetches interlinear rows once per chapter and ignores a stale chapter', async () => {
    const { useStore, fetchInterlinear } = setup();
    useStore.getState().syncChapter(params());
    useStore.getState().syncChapter({ ...params(), chapter: 7 }); // newer request replaces the first
    await vi.waitFor(() => expect(useStore.getState().chapters['tab-1']).toBeDefined());
    expect(fetchInterlinear).toHaveBeenCalledTimes(1);
    expect(fetchInterlinear).toHaveBeenCalledWith('KJV', 1, 7);
  });

  it('clears a tab and round-trips only measures* values through the session', () => {
    const { useStore } = setup([occ('reviewed')], false, 'off');
    useStore.getState().setValue('measuresSystem', 'us');
    const saved = useStore.getState().getSessionData();
    const other = setup([occ('reviewed')], false, 'off').useStore;
    other.getState().loadFromSession({ ...saved, values: { ...saved.values, evil: 1 } });
    expect(other.getState().values).toEqual({ measuresSystem: 'us' });
    expect(other.getState().resolvedPrefs('en-GB').system).toBe('us');
    other.getState().clearChapter('nope');
  });
});

describe('measure word DOM glue', () => {
  const html = `<div data-verse-id="${V}"><span class="verse-content" data-verse-id="${V}">` +
    '<span class="word" data-word-index="8">hundred</span> <span class="word" data-word-index="9"><b>cubits</b></span></span></div>';

  it('finds the word and verse of an event target, including a child element', () => {
    document.body.innerHTML = html;
    const b = document.querySelector('b')!;
    expect(wordOf(b)).toMatchObject({ verseId: V, wordIndex: 9 });
    expect(wordOf(document.body)).toBeNull();
  });

  it('only reports words the index holds occurrences for', async () => {
    const { useStore } = setup();
    useStore.getState().syncChapter(params());
    await vi.waitFor(() => expect(useStore.getState().chapters['tab-1']).toBeDefined());
    const chapter = useStore.getState().chapters['tab-1'];
    document.body.innerHTML = html;
    expect(measureWordAt(document.querySelector('b'), chapter)?.models[0].title).toBe('300 cubits');
    expect(measureWordAt(document.querySelector('[data-word-index="8"]'), chapter)).toBeNull();
    expect(measureWordAt(document.querySelector('b'), undefined)).toBeNull();
  });
});
