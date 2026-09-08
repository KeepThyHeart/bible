import { beforeEach, describe, expect, it } from 'vitest';
import { useTextSettingsStore } from './useTextSettingsStore';

/**
 * Regression tests for the "per-pane Fonts override always wins over the
 * Typography section " bug.
 *
 * Every pane component (BibleVerseList.tsx, CommentarySinglePanel.tsx,
 * BookSinglePanel.tsx, DictionarySinglePanel.tsx, ...) unconditionally sets
 * `--pane-font-size-<pane>` etc. inline from `useTextSettingsStore`'s
 * `settings`. globals.css's fallback chain
 * (`var(--pane-font-size-bible, var(--bible-font-size, 20px))`) means an
 * inline-set pane override ALWAYS wins over the Typography section's global
 * value - there is no way for that fallback to prefer the global value once
 * the pane override is defined. Since `settings` had a concrete value from
 * first render (never "unset"), the Typography sliders/font-family picker
 * were permanently shadowed for every pane, even though the CSS variables
 * they wrote were correct.
 *
 * The fix: track whether a pane has been explicitly customized via the Fonts
 * section (`customized`). A non-customized pane's `settings` are kept live in
 * sync with the Typography section's Bible/Study values (`syncFromTypography`,
 * called from usePreferencesStore.ts's `applyTypographyToDOM` - see
 * usePreferencesStore.test.ts for the store-to-store integration test).
 */
describe('useTextSettingsStore - customized/sync', () => {
  const typographyValues = {
    bible: { fontSize: 26, fontFamily: 'CustomBibleStack, serif', lineHeight: 1.9 },
    study: { fontSize: 19, fontFamily: 'CustomStudyStack, sans-serif', lineHeight: 1.65 }
  };

  beforeEach(() => {
    useTextSettingsStore.setState({
      settings: {
        bible: { fontSize: 20, fontFamily: 'Georgia', lineHeight: 1.75, showRedLetter: true },
        commentary: { fontSize: 18, fontFamily: 'Georgia', lineHeight: 1.75 },
        book: { fontSize: 18, fontFamily: 'Georgia', lineHeight: 1.75 },
        dictionary: { fontSize: 16, fontFamily: 'Georgia', lineHeight: 1.75 }
      },
      customized: { bible: false, commentary: false, book: false, dictionary: false }
    });
  });

  it('a non-customized pane follows syncFromTypography (bible <- bible tier, others <- study tier)', () => {
    useTextSettingsStore.getState().syncFromTypography(typographyValues);

    const bible = useTextSettingsStore.getState().getSettings('bible');
    expect(bible.fontSize).toBe(26);
    expect(bible.fontFamily).toBe('CustomBibleStack, serif');
    expect(bible.lineHeight).toBe(1.9);

    const dictionary = useTextSettingsStore.getState().getSettings('dictionary');
    expect(dictionary.fontSize).toBe(19);
    expect(dictionary.fontFamily).toBe('CustomStudyStack, sans-serif');
  });

  it('updateSettings (Fonts section) marks the pane customized and detaches it from future syncs', () => {
    useTextSettingsStore.getState().updateSettings('bible', { fontSize: 24 });
    expect(useTextSettingsStore.getState().customized.bible).toBe(true);

    // A Typography change after the explicit override must NOT clobber it.
    useTextSettingsStore.getState().syncFromTypography(typographyValues);
    expect(useTextSettingsStore.getState().getSettings('bible').fontSize).toBe(24);

    // An unrelated pane that was never customized keeps following.
    expect(useTextSettingsStore.getState().getSettings('commentary').fontSize).toBe(19);
  });

  it('toggling showRedLetter alone does not customize the pane (unrelated to font tier)', () => {
    useTextSettingsStore.getState().updateSettings('bible', { showRedLetter: false });
    expect(useTextSettingsStore.getState().customized.bible).toBe(false);

    useTextSettingsStore.getState().syncFromTypography(typographyValues);
    expect(useTextSettingsStore.getState().getSettings('bible').fontSize).toBe(26);
    expect(useTextSettingsStore.getState().getSettings('bible').showRedLetter).toBe(false);
  });

  it('resetSettings un-customizes the pane and reverts it to the last known Typography values', () => {
    useTextSettingsStore.getState().syncFromTypography(typographyValues);
    useTextSettingsStore.getState().updateSettings('dictionary', { fontSize: 30 });
    expect(useTextSettingsStore.getState().customized.dictionary).toBe(true);

    useTextSettingsStore.getState().resetSettings('dictionary');

    expect(useTextSettingsStore.getState().customized.dictionary).toBe(false);
    expect(useTextSettingsStore.getState().getSettings('dictionary').fontSize).toBe(19);

    // And it resumes following live.
    useTextSettingsStore.getState().syncFromTypography({
      bible: typographyValues.bible,
      study: { fontSize: 21, fontFamily: 'X', lineHeight: 1.5 }
    });
    expect(useTextSettingsStore.getState().getSettings('dictionary').fontSize).toBe(21);
  });

  it('getFontFamilyCSS falls through to an already-resolved stack instead of defaulting to Georgia', async () => {
    const { getFontFamilyCSS } = await import('./useTextSettingsStore');
    expect(getFontFamilyCSS('"Lora", Georgia, serif')).toBe('"Lora", Georgia, serif');
    // Still resolves named AVAILABLE_FONTS options normally.
    expect(getFontFamilyCSS('Merriweather')).toBe('Merriweather, Georgia, serif');
  });
});
