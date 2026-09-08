import { beforeEach, describe, expect, it } from 'vitest';
import { usePreferencesStore, DEFAULT_TYPOGRAPHY } from './usePreferencesStore';
import { getSessionSerializers } from './helpers/sessionRegistry';

/**
 * Regression tests for "Preferences persistence is dead code".
 *
 * `loadFromSession()` / `applyAll()` / `getSessionData()` existed on this
 * store but nothing ever called them - theme, global font scale, UI control
 * size, and typography reset to defaults on every restart even though the
 * Preferences dialog applied them live. AppInitService.preferences.test.ts
 * covers the actual startup wiring; this file covers the store's own
 * save/restore contract and its defensive handling of missing/corrupt data.
 */
describe('usePreferencesStore - session persistence', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.cssText = '';
    usePreferencesStore.setState({
      theme: 'light',
      globalFontScale: 1.0,
      uiControlFontSize: 14,
      typography: { ...DEFAULT_TYPOGRAPHY },
      advancedPaneManagerEnabled: false
    });
  });

  it('registers a "preferences" session serializer that mirrors getSessionData()', () => {
    usePreferencesStore.getState().setTheme('sepia');
    const serializer = getSessionSerializers().get('preferences');
    expect(serializer).toBeDefined();
    expect(serializer!()).toEqual(usePreferencesStore.getState().getSessionData());
  });

  it('full round trip: every persisted field survives getSessionData -> loadFromSession', () => {
    usePreferencesStore.getState().setTheme('dark');
    usePreferencesStore.getState().setGlobalFontScale(1.35);
    usePreferencesStore.getState().setUiControlFontSize(19);
    usePreferencesStore.getState().setAdvancedPaneManagerEnabled(true);
    usePreferencesStore.getState().setTypography({
      bibleFontSize: 34,
      studyFontSize: 24,
      uiFontSize: 18,
      bibleLineHeight: 2.1,
      studyLineHeight: 1.85,
      uiLineHeight: 1.7,
      bibleFontFamily: 'lora',
      studyFontFamily: 'merriweather',
      uiFontFamily: 'garamond'
    });

    const saved = usePreferencesStore.getState().getSessionData();

    // Reset to defaults, as would happen on a fresh app boot before restore.
    usePreferencesStore.setState({
      theme: 'light',
      globalFontScale: 1.0,
      uiControlFontSize: 14,
      typography: { ...DEFAULT_TYPOGRAPHY },
      advancedPaneManagerEnabled: false
    });
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.cssText = '';

    usePreferencesStore.getState().loadFromSession(saved);

    expect(usePreferencesStore.getState().theme).toBe('dark');
    expect(usePreferencesStore.getState().globalFontScale).toBe(1.35);
    expect(usePreferencesStore.getState().uiControlFontSize).toBe(19);
    expect(usePreferencesStore.getState().typography).toEqual(saved.typography);
    expect(usePreferencesStore.getState().advancedPaneManagerEnabled).toBe(true);

    // And it went through the same DOM-application path as a live edit.
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--bible-font-size')).toBe('34px');
    expect(document.documentElement.style.getPropertyValue('--global-font-scale')).toBe('1.35');
    expect(document.documentElement.style.getPropertyValue('--ui-control-font-size')).toBe('19px');
  });

  it('falls back to defaults on a missing/empty session blob without crashing', () => {
    usePreferencesStore.getState().loadFromSession({});

    expect(usePreferencesStore.getState().theme).toBe('light');
    expect(usePreferencesStore.getState().globalFontScale).toBe(1.0);
    expect(usePreferencesStore.getState().uiControlFontSize).toBe(14);
    expect(usePreferencesStore.getState().typography).toEqual(DEFAULT_TYPOGRAPHY);
    expect(usePreferencesStore.getState().advancedPaneManagerEnabled).toBe(false);
  });

  // Regression: bumping DEFAULT_TYPOGRAPHY.studyFontSize from 15 to 16 must
  // not silently override an existing user's saved preference - sanitizeTypography
  // only falls back to the default when the saved field is missing or
  // out-of-range, so a pre-bump session that explicitly saved 15 (the old
  // default) is a perfectly valid in-range value and must be preserved as-is.
  it('a saved session with an explicit (pre-bump) studyFontSize of 15 still loads as 15', () => {
    usePreferencesStore.getState().loadFromSession({
      typography: { studyFontSize: 15 },
    });
    expect(usePreferencesStore.getState().typography.studyFontSize).toBe(15);
    expect(document.documentElement.style.getPropertyValue('--study-font-size')).toBe('15px');
  });

  it('an out-of-range saved studyFontSize falls back to the new default (16), not the old one', () => {
    usePreferencesStore.getState().loadFromSession({
      typography: { studyFontSize: 999 },
    });
    expect(usePreferencesStore.getState().typography.studyFontSize).toBe(DEFAULT_TYPOGRAPHY.studyFontSize);
    expect(usePreferencesStore.getState().typography.studyFontSize).toBe(16);
  });

  it('falls back to false on a non-boolean advancedPaneManagerEnabled instead of crashing', () => {
    usePreferencesStore.getState().loadFromSession({
      // @ts-expect-error - simulating a corrupt/mistyped saved value
      advancedPaneManagerEnabled: 'yes',
    });

    expect(usePreferencesStore.getState().advancedPaneManagerEnabled).toBe(false);
  });

  it('falls back per-field on corrupt data instead of crashing or half-applying', () => {
    usePreferencesStore.getState().loadFromSession({
      // Invalid theme id (e.g. a theme removed in a later version).
      theme: 'not-a-real-theme',
      // Out-of-range / wrong-type numbers.
      globalFontScale: 999,
      uiControlFontSize: Number.NaN,
      typography: {
        bibleFontSize: -5, // out of range
        // @ts-expect-error - simulating a corrupt/mistyped saved value
        studyFontSize: 'huge',
        uiFontSize: DEFAULT_TYPOGRAPHY.uiFontSize, // one valid field...
        bibleLineHeight: Infinity,
        studyLineHeight: DEFAULT_TYPOGRAPHY.studyLineHeight, // ...and one more valid field
        uiLineHeight: 1.4,
        bibleFontFamily: 'not-a-known-font-id',
        studyFontFamily: DEFAULT_TYPOGRAPHY.studyFontFamily,
        uiFontFamily: 'garamond'
      }
    });

    const state = usePreferencesStore.getState();
    expect(state.theme).toBe('light');
    expect(state.globalFontScale).toBe(1.0);
    expect(state.uiControlFontSize).toBe(14);

    // Bad fields fell back to defaults...
    expect(state.typography.bibleFontSize).toBe(DEFAULT_TYPOGRAPHY.bibleFontSize);
    expect(state.typography.studyFontSize).toBe(DEFAULT_TYPOGRAPHY.studyFontSize);
    expect(state.typography.bibleLineHeight).toBe(DEFAULT_TYPOGRAPHY.bibleLineHeight);
    expect(state.typography.bibleFontFamily).toBe(DEFAULT_TYPOGRAPHY.bibleFontFamily);
    // ...while valid fields in the same object were preserved, not wiped out
    // wholesale by the corrupt neighbors.
    expect(state.typography.uiFontSize).toBe(DEFAULT_TYPOGRAPHY.uiFontSize);
    expect(state.typography.studyLineHeight).toBe(DEFAULT_TYPOGRAPHY.studyLineHeight);
    expect(state.typography.uiLineHeight).toBe(1.4);
    expect(state.typography.uiFontFamily).toBe('garamond');

    // Never leaves a half-applied theme: DOM reflects the fully-sanitized state.
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('applyAll() re-applies the current in-memory state to the DOM (used on the no-session-data startup path)', () => {
    usePreferencesStore.setState({
      theme: 'forest',
      globalFontScale: 1.1,
      uiControlFontSize: 15,
      typography: { ...DEFAULT_TYPOGRAPHY, bibleFontSize: 21 }
    });
    // Simulate a fresh DOM (nothing applied yet).
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.cssText = '';

    usePreferencesStore.getState().applyAll();

    expect(document.documentElement.getAttribute('data-theme')).toBe('forest');
    expect(document.documentElement.style.getPropertyValue('--global-font-scale')).toBe('1.1');
    expect(document.documentElement.style.getPropertyValue('--ui-control-font-size')).toBe('15px');
    expect(document.documentElement.style.getPropertyValue('--bible-font-size')).toBe('21px');
  });
});
