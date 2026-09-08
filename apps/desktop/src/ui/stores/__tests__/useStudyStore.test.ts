/**
 * Study store: verse sync, pin behaviour, and the fresh-open default.
 *
 * These cover two regressions:
 *  - selecting a verse in the Bible pane left an already-populated Study pane
 *    showing the previous verse behind a "See study for X" banner;
 *  - a freshly opened Study pane had nothing to show at all.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useStudyStore, clearPersistedStudyVerses } from '../useStudyStore';

const GEN_1_1 = 1001001;
const JOHN_3_16 = 43003016;
const ROM_8_28 = 45008028;

const PANEL = 'study-1';

function panelState(panelId = PANEL) {
  return useStudyStore.getState().getPanelState(panelId);
}

describe('useStudyStore', () => {
  beforeEach(() => {
    useStudyStore.setState({ panels: new Map() });
    clearPersistedStudyVerses();
  });

  describe('syncAllPanelsWithVerse', () => {
    it('moves an empty panel to the selected verse', () => {
      useStudyStore.getState().initPanel(PANEL);
      useStudyStore.getState().syncAllPanelsWithVerse(JOHN_3_16);
      expect(panelState().currentVerseId).toBe(JOHN_3_16);
    });

    it('moves a panel that is already showing another verse', () => {
      useStudyStore.getState().initPanel(PANEL);
      useStudyStore.getState().navigateToVerse(PANEL, GEN_1_1);

      useStudyStore.getState().syncAllPanelsWithVerse(JOHN_3_16);

      expect(panelState().currentVerseId).toBe(JOHN_3_16);
      expect(panelState().suggestionVerseId).toBeNull();
    });

    it('records the move in the navigation stack so Back returns', () => {
      useStudyStore.getState().initPanel(PANEL);
      useStudyStore.getState().navigateToVerse(PANEL, GEN_1_1);
      useStudyStore.getState().syncAllPanelsWithVerse(JOHN_3_16);

      useStudyStore.getState().goBack(PANEL);
      expect(panelState().currentVerseId).toBe(GEN_1_1);
    });

    it('does nothing when the panel is already on that verse', () => {
      useStudyStore.getState().initPanel(PANEL);
      useStudyStore.getState().navigateToVerse(PANEL, JOHN_3_16);
      const before = panelState().navStack.length;

      useStudyStore.getState().syncAllPanelsWithVerse(JOHN_3_16);

      expect(panelState().navStack.length).toBe(before);
    });

    it('follows the verse in every unpinned panel', () => {
      useStudyStore.getState().initPanel('a');
      useStudyStore.getState().initPanel('b');
      useStudyStore.getState().syncAllPanelsWithVerse(ROM_8_28);
      expect(panelState('a').currentVerseId).toBe(ROM_8_28);
      expect(panelState('b').currentVerseId).toBe(ROM_8_28);
    });

    // -- Pinning ------------------------------------------------------------

    it('leaves a pinned panel where it is and offers the new verse', () => {
      useStudyStore.getState().initPanel(PANEL);
      useStudyStore.getState().navigateToVerse(PANEL, GEN_1_1);
      useStudyStore.getState().togglePin(PANEL);

      useStudyStore.getState().syncAllPanelsWithVerse(JOHN_3_16);

      expect(panelState().currentVerseId).toBe(GEN_1_1);
      expect(panelState().suggestionVerseId).toBe(JOHN_3_16);
    });

    it('offers nothing when the pin is already on the selected verse', () => {
      useStudyStore.getState().initPanel(PANEL);
      useStudyStore.getState().navigateToVerse(PANEL, JOHN_3_16);
      useStudyStore.getState().togglePin(PANEL);

      useStudyStore.getState().syncAllPanelsWithVerse(JOHN_3_16);

      expect(panelState().suggestionVerseId).toBeNull();
    });
  });

  describe('acceptSuggestion', () => {
    it('releases the pin and moves to the offered verse', () => {
      useStudyStore.getState().initPanel(PANEL);
      useStudyStore.getState().navigateToVerse(PANEL, GEN_1_1);
      useStudyStore.getState().togglePin(PANEL);
      useStudyStore.getState().syncAllPanelsWithVerse(JOHN_3_16);

      useStudyStore.getState().acceptSuggestion(PANEL);

      expect(panelState().currentVerseId).toBe(JOHN_3_16);
      expect(panelState().pinned).toBe(false);
      expect(panelState().suggestionVerseId).toBeNull();
    });

    it('does nothing when there is no offer', () => {
      useStudyStore.getState().initPanel(PANEL);
      useStudyStore.getState().acceptSuggestion(PANEL);
      expect(panelState().currentVerseId).toBeNull();
    });
  });

  describe('seedInitialVerse', () => {
    it('adopts the Bible pane verse on a fresh open', () => {
      useStudyStore.getState().initPanel(PANEL);
      useStudyStore.getState().seedInitialVerse(PANEL, JOHN_3_16);
      expect(panelState().currentVerseId).toBe(JOHN_3_16);
    });

    it('prefers the verse the panel was last showing', () => {
      useStudyStore.getState().initPanel(PANEL);
      useStudyStore.getState().navigateToVerse(PANEL, ROM_8_28);

      // Simulate a relaunch: same panel id, fresh store.
      useStudyStore.setState({ panels: new Map() });
      useStudyStore.getState().initPanel(PANEL);
      useStudyStore.getState().seedInitialVerse(PANEL, JOHN_3_16);

      expect(panelState().currentVerseId).toBe(ROM_8_28);
    });

    it('leaves a populated panel alone', () => {
      useStudyStore.getState().initPanel(PANEL);
      useStudyStore.getState().navigateToVerse(PANEL, GEN_1_1);
      useStudyStore.getState().seedInitialVerse(PANEL, JOHN_3_16);
      expect(panelState().currentVerseId).toBe(GEN_1_1);
    });

    it('stays empty when there is nothing to seed from', () => {
      useStudyStore.getState().initPanel(PANEL);
      useStudyStore.getState().seedInitialVerse(PANEL, null);
      expect(panelState().currentVerseId).toBeNull();
      expect(panelState().navStack).toEqual([]);
    });

    it('ignores a nonsense fallback verse', () => {
      useStudyStore.getState().initPanel(PANEL);
      useStudyStore.getState().seedInitialVerse(PANEL, 0);
      expect(panelState().currentVerseId).toBeNull();
    });

    it('survives unreadable persisted state', () => {
      window.localStorage.setItem('study-pane-verses', 'not json');
      useStudyStore.getState().initPanel(PANEL);
      useStudyStore.getState().seedInitialVerse(PANEL, JOHN_3_16);
      expect(panelState().currentVerseId).toBe(JOHN_3_16);
    });

    it('keeps each panel on its own remembered verse', () => {
      useStudyStore.getState().initPanel('a');
      useStudyStore.getState().initPanel('b');
      useStudyStore.getState().navigateToVerse('a', GEN_1_1);
      useStudyStore.getState().navigateToVerse('b', ROM_8_28);

      useStudyStore.setState({ panels: new Map() });
      useStudyStore.getState().initPanel('a');
      useStudyStore.getState().initPanel('b');
      useStudyStore.getState().seedInitialVerse('a', JOHN_3_16);
      useStudyStore.getState().seedInitialVerse('b', JOHN_3_16);

      expect(panelState('a').currentVerseId).toBe(GEN_1_1);
      expect(panelState('b').currentVerseId).toBe(ROM_8_28);
    });
  });

  describe('clearVerse', () => {
    it('empties the pane and forgets the restore point', () => {
      useStudyStore.getState().initPanel(PANEL);
      useStudyStore.getState().navigateToVerse(PANEL, GEN_1_1);

      useStudyStore.getState().clearVerse(PANEL);
      expect(panelState().currentVerseId).toBeNull();
      expect(panelState().navStack).toEqual([]);

      useStudyStore.setState({ panels: new Map() });
      useStudyStore.getState().initPanel(PANEL);
      useStudyStore.getState().seedInitialVerse(PANEL, null);
      expect(panelState().currentVerseId).toBeNull();
    });
  });
});
