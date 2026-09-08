import { describe, it, expect } from 'vitest';
import { useTextSettingsStore } from './useTextSettingsStore';

/**
 * Regression tests for "Commentary line-height too large by default"
 * (KAN QA). `usePreferencesStore.DEFAULT_TYPOGRAPHY.studyLineHeight` (and
 * web's equivalent) are 1.6, and `useTextSettingsStore`'s per-pane bootstrap
 * defaults must match that from construction: leaving
 * `commentary`/`book`/`dictionary` at `DEFAULT_SETTINGS.lineHeight` (1.75,
 * the "bible" tier value) until the first `syncFromTypography` call lands
 * would reproduce the bug. This file asserts the store's OWN initial
 * construction already matches the study tier (1.6) - unlike
 * `useTextSettingsStore.test.ts` / `useTextSettingsStore.sessionPersistence.test.ts`,
 * which reset state via `setState` in `beforeEach` and so never exercise the
 * real bootstrap defaults.
 *
 * This file does not reset store state itself (no `beforeEach`), relying on
 * Vitest's per-test-file module isolation to give a pristine store.
 */
describe('useTextSettingsStore - line height defaults', () => {
  it('fresh (unsynced) defaults give 1.6 line-height for commentary/book/dictionary, matching the study typography tier', () => {
    const commentary = useTextSettingsStore.getState().getSettings('commentary');
    const book = useTextSettingsStore.getState().getSettings('book');
    const dictionary = useTextSettingsStore.getState().getSettings('dictionary');

    expect(commentary.lineHeight).toBe(1.6);
    expect(book.lineHeight).toBe(1.6);
    expect(dictionary.lineHeight).toBe(1.6);
  });

  it('the bible pane keeps the bible-tier default (1.75), unaffected by the study-tier fix', () => {
    expect(useTextSettingsStore.getState().getSettings('bible').lineHeight).toBe(1.75);
  });

  it('none of the panes start "customized" — the study-tier default still follows live Typography sync', () => {
    const customized = useTextSettingsStore.getState().customized;
    expect(customized).toEqual({ bible: false, commentary: false, book: false, dictionary: false });

    useTextSettingsStore.getState().syncFromTypography({
      bible: { fontSize: 22, fontFamily: 'X', lineHeight: 1.8 },
      study: { fontSize: 17, fontFamily: 'Y', lineHeight: 1.5 }
    });
    expect(useTextSettingsStore.getState().getSettings('commentary').lineHeight).toBe(1.5);
  });

  it('a user-customized commentary pane keeps its own line-height through syncFromTypography (does not get clobbered back to the study default)', () => {
    useTextSettingsStore.getState().updateSettings('commentary', { lineHeight: 2.0 });
    expect(useTextSettingsStore.getState().customized.commentary).toBe(true);

    useTextSettingsStore.getState().syncFromTypography({
      bible: { fontSize: 20, fontFamily: 'X', lineHeight: 1.75 },
      study: { fontSize: 15, fontFamily: 'Y', lineHeight: 1.6 }
    });

    expect(useTextSettingsStore.getState().getSettings('commentary').lineHeight).toBe(2.0);
  });

  it('a saved session round-trips: a non-customized commentary pane restores at 1.6 and a customized one restores at its own saved value', () => {
    // This test runs after others in the file that customize the commentary
    // pane; start from a known-clean slate rather than depending on suite
    // order, since this test's own point is the non-customized 1.6 default.
    useTextSettingsStore.setState((state) => ({
      settings: { ...state.settings, commentary: { ...state.settings.commentary, lineHeight: 1.6 } },
      customized: { ...state.customized, commentary: false }
    }));

    // Customize dictionary explicitly; leave commentary alone (follows the study default).
    useTextSettingsStore.getState().updateSettings('dictionary', { lineHeight: 1.9 });
    expect(useTextSettingsStore.getState().customized.dictionary).toBe(true);
    expect(useTextSettingsStore.getState().customized.commentary).toBe(false);
    expect(useTextSettingsStore.getState().getSettings('commentary').lineHeight).toBe(1.6);

    const savedSettings = useTextSettingsStore.getState().getSessionData();
    const savedCustomized = useTextSettingsStore.getState().customized;

    // Simulate a fresh app boot: reset to the store's own bootstrap defaults.
    useTextSettingsStore.setState({
      settings: {
        bible: { ...useTextSettingsStore.getState().settings.bible },
        commentary: { fontSize: 18, fontFamily: 'Georgia', lineHeight: 1.6 },
        book: { fontSize: 18, fontFamily: 'Georgia', lineHeight: 1.6 },
        dictionary: { fontSize: 16, fontFamily: 'Georgia', lineHeight: 1.6 }
      },
      customized: { bible: false, commentary: false, book: false, dictionary: false }
    });

    useTextSettingsStore.getState().loadFromSession(savedSettings, savedCustomized);

    expect(useTextSettingsStore.getState().getSettings('dictionary').lineHeight).toBe(1.9);
    expect(useTextSettingsStore.getState().customized.dictionary).toBe(true);
    expect(useTextSettingsStore.getState().getSettings('commentary').lineHeight).toBe(1.6);
    expect(useTextSettingsStore.getState().customized.commentary).toBe(false);

    // And the restored non-customized pane still resumes following live Typography sync.
    useTextSettingsStore.getState().syncFromTypography({
      bible: { fontSize: 20, fontFamily: 'X', lineHeight: 1.75 },
      study: { fontSize: 15, fontFamily: 'Y', lineHeight: 1.55 }
    });
    expect(useTextSettingsStore.getState().getSettings('commentary').lineHeight).toBe(1.55);
    // The customized pane is untouched by the sync.
    expect(useTextSettingsStore.getState().getSettings('dictionary').lineHeight).toBe(1.9);
  });
});
