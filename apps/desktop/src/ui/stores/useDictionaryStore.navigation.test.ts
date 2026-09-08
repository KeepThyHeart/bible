/**
 * Back and forward through a dictionary pane's lookups.
 *
 * A dictionary is a place you wander: one entry names three more, and following
 * them is the point. Until this existed the only way back was to retype what
 * you had just left - "Recent" is a global, de-duplicated, most-recent-first
 * menu, which is a different thing from a per-pane trail with a cursor in it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDictionaryStore } from './useDictionaryStore';
import { dictionaryAPI } from '../services/electronAPI';

vi.mock('../services/electronAPI', () => ({
  dictionaryAPI: {
    getAvailableDictionaries: vi.fn().mockResolvedValue([]),
    getEntryByKey: vi.fn(),
    getEntry: vi.fn(),
    getAllEntries: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('./helpers/sessionNotifier', () => ({
  markSessionDirty: vi.fn(),
}));

const PANEL = 'dictionary_abc';

/** An entry the API can return for whatever key was asked for. */
function entryFor(key: string) {
  return { entry_key: key, word: `word-${key}`, definition: `definition ${key}` };
}

function nav() {
  const state = useDictionaryStore.getState().getPanelState(PANEL);
  return {
    trail: state.navHistory.map(e => `${e.abbreviation}:${e.entryKey}`),
    index: state.navIndex,
  };
}

describe('useDictionaryStore navigation history', () => {
  beforeEach(() => {
    useDictionaryStore.setState({
      availableDictionaries: [],
      loadingDictionaries: false,
      recentLookups: [],
      panels: new Map(),
    });
    vi.clearAllMocks();
    vi.mocked(dictionaryAPI.getEntryByKey).mockImplementation(
      async (_abbr: string, key: string) => entryFor(key),
    );
    useDictionaryStore.getState().openDictionary(PANEL, 'strongs', "Strong's");
  });

  it('starts with an empty trail', () => {
    expect(nav()).toEqual({ trail: [], index: -1 });
  });

  it('records each lookup in the order it was made', async () => {
    const store = useDictionaryStore.getState();
    await store.lookupEntry(PANEL, 'strongs', '00025');
    await store.lookupEntry(PANEL, 'strongs', '00026');

    expect(nav()).toEqual({ trail: ['strongs:00025', 'strongs:00026'], index: 1 });
  });

  // A retry, or a session restore landing on the entry already showing, must
  // not stack a duplicate that then takes two Backs to get past.
  it('does not stack the entry it is already on', async () => {
    const store = useDictionaryStore.getState();
    await store.lookupEntry(PANEL, 'strongs', '00025');
    await store.lookupEntry(PANEL, 'strongs', '00025');

    expect(nav()).toEqual({ trail: ['strongs:00025'], index: 0 });
  });

  it('moves the cursor back and forward without changing the trail', async () => {
    const store = useDictionaryStore.getState();
    await store.lookupEntry(PANEL, 'strongs', '00025');
    await store.lookupEntry(PANEL, 'strongs', '00026');

    await useDictionaryStore.getState().goBack(PANEL);
    expect(nav()).toEqual({ trail: ['strongs:00025', 'strongs:00026'], index: 0 });

    await useDictionaryStore.getState().goForward(PANEL);
    expect(nav()).toEqual({ trail: ['strongs:00025', 'strongs:00026'], index: 1 });
  });

  it('shows the entry it stepped to', async () => {
    const store = useDictionaryStore.getState();
    await store.lookupEntry(PANEL, 'strongs', '00025');
    await store.lookupEntry(PANEL, 'strongs', '00026');

    await useDictionaryStore.getState().goBack(PANEL);

    const shown = useDictionaryStore.getState().getPanelState(PANEL).entriesByTab.get('strongs');
    expect(shown?.entry_key).toBe('00025');
  });

  it('is a no-op at each end of the trail', async () => {
    const store = useDictionaryStore.getState();
    await store.lookupEntry(PANEL, 'strongs', '00025');

    await useDictionaryStore.getState().goBack(PANEL);
    expect(nav().index).toBe(0);

    await useDictionaryStore.getState().goForward(PANEL);
    expect(nav().index).toBe(0);
  });

  // The browser rule: looking something new up after stepping back abandons the
  // forward branch, rather than leaving a Forward button that jumps somewhere
  // the reader has no memory of going.
  it('truncates the forward branch when a new lookup follows a step back', async () => {
    const store = useDictionaryStore.getState();
    await store.lookupEntry(PANEL, 'strongs', '00025');
    await store.lookupEntry(PANEL, 'strongs', '00026');
    await useDictionaryStore.getState().goBack(PANEL);

    await useDictionaryStore.getState().lookupEntry(PANEL, 'strongs', '00027');

    expect(nav()).toEqual({ trail: ['strongs:00025', 'strongs:00027'], index: 1 });
  });

  it('follows a step into another dictionary by activating its tab', async () => {
    const store = useDictionaryStore.getState();
    store.openDictionary(PANEL, 'easton', "Easton's");

    await useDictionaryStore.getState().lookupEntry(PANEL, 'strongs', '00025');
    await useDictionaryStore.getState().lookupEntry(PANEL, 'easton', 'Love');
    expect(useDictionaryStore.getState().getPanelState(PANEL).activeTabIndex).toBe(1);

    await useDictionaryStore.getState().goBack(PANEL);

    // Back to Strong's, and the tab moves with it - otherwise the pane would
    // say it had gone back while showing a different dictionary.
    expect(useDictionaryStore.getState().getPanelState(PANEL).activeTabIndex).toBe(0);
  });

  // Closing a tab does not rewrite the trail, so a step can name a dictionary
  // that is no longer open. The cursor still moves, or a second Back would jam
  // on the dead step forever.
  it('walks past a step whose dictionary has been closed', async () => {
    const store = useDictionaryStore.getState();
    store.openDictionary(PANEL, 'easton', "Easton's");

    await useDictionaryStore.getState().lookupEntry(PANEL, 'strongs', '00025');
    await useDictionaryStore.getState().lookupEntry(PANEL, 'easton', 'Love');
    await useDictionaryStore.getState().lookupEntry(PANEL, 'strongs', '00026');
    useDictionaryStore.getState().closeDictionary(PANEL, 'easton');

    await useDictionaryStore.getState().goBack(PANEL);
    expect(nav().index).toBe(1);

    await useDictionaryStore.getState().goBack(PANEL);
    expect(nav().index).toBe(0);
    expect(useDictionaryStore.getState().getPanelState(PANEL).entriesByTab.get('strongs')?.entry_key)
      .toBe('00025');
  });

  it('does not record a lookup that found nothing', async () => {
    vi.mocked(dictionaryAPI.getEntryByKey).mockResolvedValueOnce(null);

    await useDictionaryStore.getState().lookupEntry(PANEL, 'strongs', 'nosuchthing');

    expect(nav()).toEqual({ trail: [], index: -1 });
  });

  it('keeps the trails of two panes independent', async () => {
    const other = 'dictionary_def';
    useDictionaryStore.getState().openDictionary(other, 'strongs', "Strong's");

    await useDictionaryStore.getState().lookupEntry(PANEL, 'strongs', '00025');
    await useDictionaryStore.getState().lookupEntry(other, 'strongs', '00099');

    expect(useDictionaryStore.getState().getPanelState(PANEL).navHistory).toHaveLength(1);
    expect(useDictionaryStore.getState().getPanelState(other).navHistory[0].entryKey).toBe('00099');
  });
});
