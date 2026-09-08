/**
 * The Books/Dictionary pane that is actually on screen is created by
 * dockview with its own generated panel id (see BookPane.tsx) - never
 * `DEFAULT_PANEL_ID`. Always writing a Strong's-number lookup to
 * `DEFAULT_PANEL_ID` instead would land it on a panel-state entry nothing
 * renders, so the click would appear to do nothing.
 *
 * These tests pin that `lookupStrongsNumber` writes to whatever real panel id
 * it is given, mirroring the wiring pattern in studyOptionsWiring.test.tsx.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDictionaryStore, DEFAULT_PANEL_ID } from './useDictionaryStore';

vi.mock('../services/electronAPI', () => ({
  dictionaryAPI: {
    getAvailableDictionaries: vi.fn().mockResolvedValue([
      { abbreviation: 'StrongsGreek', name: "Strong's Greek Lexicon", database_path: 'x' },
      { abbreviation: 'StrongsHebrew', name: "Strong's Hebrew Lexicon", database_path: 'y' },
    ]),
    getEntryByKey: vi.fn().mockResolvedValue({
      entry_key: '00025',
      word: 'agape',
      definition: 'love',
    }),
  },
}));

vi.mock('./helpers/sessionNotifier', () => ({
  markSessionDirty: vi.fn(),
}));

const REAL_PANEL = 'book_abc123';

describe('useDictionaryStore.lookupStrongsNumber', () => {
  beforeEach(() => {
    useDictionaryStore.setState({
      availableDictionaries: [],
      loadingDictionaries: false,
      studyPaneActiveTab: 'commentary',
      recentLookups: [],
      panels: new Map(),
    });
    vi.clearAllMocks();
  });

  it('opens the dictionary tab and looks up the entry on the given panel id, not DEFAULT_PANEL_ID', async () => {
    await useDictionaryStore.getState().lookupStrongsNumber('G25', REAL_PANEL);

    const realPanelState = useDictionaryStore.getState().getPanelState(REAL_PANEL);
    expect(realPanelState.openTabs.map(t => t.abbreviation)).toContain('StrongsGreek');
    expect(realPanelState.entriesByTab.get('StrongsGreek')?.entry_key).toBe('00025');

    const defaultPanelState = useDictionaryStore.getState().getPanelState(DEFAULT_PANEL_ID);
    expect(defaultPanelState.openTabs).toHaveLength(0);
  });

  it('brings the Dictionary tab forward regardless of panel id', async () => {
    await useDictionaryStore.getState().lookupStrongsNumber('H0430', REAL_PANEL);

    // Dictionary is its own study-column slot; selecting the Books tab
    // instead would leave the lexicon invisible behind it.
    expect(useDictionaryStore.getState().studyPaneActiveTab).toBe('dictionary');
  });
});
