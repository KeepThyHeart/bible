import { beforeEach, describe, expect, it } from 'vitest';
import { useTextSettingsStore } from './useTextSettingsStore';
import { getSessionSerializers } from './helpers/sessionRegistry';

/**
 * Regression tests for `useTextSettingsStore`'s session persistence,
 * specifically the `customized` flag's save/restore contract.
 *
 * Before this fix, `loadFromSession()` unconditionally marked every restored
 * pane `customized: true` regardless of what was actually saved. Once the
 * `customized` flag started being persisted (`textSettingsCustomized` in the
 * session), that behavior would have meant EVERY session restore froze every
 * pane out of the Typography section's live sync forever - reintroducing the
 * exact "sliders do nothing" bug the `customized` flag exists to prevent.
 * The fix restores the flag from what was actually saved, defaulting missing
 * panes (including all of them, for a session saved before this field
 * existed) to `false` - not `true`.
 */
describe('useTextSettingsStore - session persistence', () => {
  const DEFAULTS = {
    bible: { fontSize: 20, fontFamily: 'Georgia', lineHeight: 1.75, showRedLetter: true },
    commentary: { fontSize: 18, fontFamily: 'Georgia', lineHeight: 1.75 },
    book: { fontSize: 18, fontFamily: 'Georgia', lineHeight: 1.75 },
    dictionary: { fontSize: 16, fontFamily: 'Georgia', lineHeight: 1.75 }
  };

  beforeEach(() => {
    useTextSettingsStore.setState({
      settings: {
        bible: { ...DEFAULTS.bible },
        commentary: { ...DEFAULTS.commentary },
        book: { ...DEFAULTS.book },
        dictionary: { ...DEFAULTS.dictionary }
      },
      customized: { bible: false, commentary: false, book: false, dictionary: false }
    });
  });

  it('registers "textSettings" and "textSettingsCustomized" session serializers', () => {
    useTextSettingsStore.getState().updateSettings('bible', { fontSize: 27 });
    const settingsSerializer = getSessionSerializers().get('textSettings');
    const customizedSerializer = getSessionSerializers().get('textSettingsCustomized');
    expect(settingsSerializer).toBeDefined();
    expect(customizedSerializer).toBeDefined();
    expect((settingsSerializer!() as Record<string, unknown>).bible).toEqual(
      useTextSettingsStore.getState().getSettings('bible')
    );
    expect(customizedSerializer!()).toEqual(useTextSettingsStore.getState().customized);
  });

  it('full round trip: settings AND customized flags survive save -> restore for every pane', () => {
    useTextSettingsStore.getState().updateSettings('bible', {
      fontSize: 28, fontFamily: 'Merriweather', lineHeight: 1.9
    });
    useTextSettingsStore.getState().updateSettings('dictionary', {
      fontSize: 17, fontFamily: 'Garamond', lineHeight: 1.6
    });
    // commentary/book left un-customized, following Typography sync.
    useTextSettingsStore.getState().syncFromTypography({
      bible: { fontSize: 99, fontFamily: 'ignored, since bible is customized', lineHeight: 1 },
      study: { fontSize: 21, fontFamily: 'SyncedStudyStack, serif', lineHeight: 1.55 }
    });

    const savedSettings = useTextSettingsStore.getState().getSessionData();
    const savedCustomized = useTextSettingsStore.getState().customized;
    expect(savedCustomized).toEqual({ bible: true, commentary: false, book: false, dictionary: true });

    // Reset store to a clean slate, as at app boot.
    useTextSettingsStore.setState({
      settings: {
        bible: { ...DEFAULTS.bible },
        commentary: { ...DEFAULTS.commentary },
        book: { ...DEFAULTS.book },
        dictionary: { ...DEFAULTS.dictionary }
      },
      customized: { bible: false, commentary: false, book: false, dictionary: false }
    });

    useTextSettingsStore.getState().loadFromSession(savedSettings, savedCustomized);

    expect(useTextSettingsStore.getState().customized).toEqual(savedCustomized);
    expect(useTextSettingsStore.getState().getSettings('bible')).toEqual(
      expect.objectContaining({ fontSize: 28, fontFamily: 'Merriweather', lineHeight: 1.9 })
    );
    expect(useTextSettingsStore.getState().getSettings('dictionary')).toEqual(
      expect.objectContaining({ fontSize: 17, fontFamily: 'Garamond', lineHeight: 1.6 })
    );
    expect(useTextSettingsStore.getState().getSettings('commentary').fontSize).toBe(21);
  });

  it('a session predating `customized` (no second argument) defaults every restored pane to NOT customized', () => {
    useTextSettingsStore.getState().loadFromSession({
      bible: { fontSize: 24, fontFamily: 'Times New Roman', lineHeight: 1.8 },
      commentary: { fontSize: 20, fontFamily: 'Times New Roman', lineHeight: 1.8 }
      // no `book`/`dictionary` entries, and no second (customizedData) argument at all.
    });

    // The critical migration assertion: must default to false, not true.
    expect(useTextSettingsStore.getState().customized.bible).toBe(false);
    expect(useTextSettingsStore.getState().customized.commentary).toBe(false);
    // Panes absent from the legacy blob are untouched (still their prior state).
    expect(useTextSettingsStore.getState().customized.book).toBe(false);
    expect(useTextSettingsStore.getState().customized.dictionary).toBe(false);

    // The saved values are still applied, just not "locked".
    expect(useTextSettingsStore.getState().getSettings('bible').fontSize).toBe(24);

    // And because it is not customized, it now resumes following Typography live.
    useTextSettingsStore.getState().syncFromTypography({
      bible: { fontSize: 31, fontFamily: 'X', lineHeight: 2 },
      study: { fontSize: 21, fontFamily: 'Y', lineHeight: 1.5 }
    });
    expect(useTextSettingsStore.getState().getSettings('bible').fontSize).toBe(31);
  });

  it('a partial customizedData object only marks the panes it explicitly lists', () => {
    useTextSettingsStore.getState().loadFromSession(
      {
        bible: { fontSize: 24, fontFamily: 'Georgia', lineHeight: 1.75 },
        commentary: { fontSize: 20, fontFamily: 'Georgia', lineHeight: 1.75 }
      },
      { bible: true } // commentary intentionally omitted
    );

    expect(useTextSettingsStore.getState().customized.bible).toBe(true);
    expect(useTextSettingsStore.getState().customized.commentary).toBe(false);
  });

  it('falls back per-field on corrupt saved pane data instead of crashing or producing NaN', () => {
    useTextSettingsStore.getState().loadFromSession({
      bible: {
        fontSize: Number.NaN,
        // @ts-expect-error - simulating a corrupt/mistyped saved value
        fontFamily: 12345,
        lineHeight: -1 // out of range
      },
      commentary: {
        fontSize: 23, // valid
        fontFamily: 'Palatino', // valid
        lineHeight: 1.65 // valid
      }
    });

    const bible = useTextSettingsStore.getState().getSettings('bible');
    // Every corrupt field on `bible` fell back to its prior (default) value.
    expect(bible.fontSize).toBe(DEFAULTS.bible.fontSize);
    expect(bible.fontFamily).toBe(DEFAULTS.bible.fontFamily);
    expect(bible.lineHeight).toBe(DEFAULTS.bible.lineHeight);
    expect(Number.isNaN(bible.fontSize)).toBe(false);

    // A pane with fully valid data is restored verbatim.
    const commentary = useTextSettingsStore.getState().getSettings('commentary');
    expect(commentary).toEqual(expect.objectContaining({ fontSize: 23, fontFamily: 'Palatino', lineHeight: 1.65 }));
  });

  it('an empty/missing session object leaves settings and customized untouched', () => {
    useTextSettingsStore.getState().updateSettings('bible', { fontSize: 25 });
    const before = useTextSettingsStore.getState().settings;
    const beforeCustomized = useTextSettingsStore.getState().customized;

    useTextSettingsStore.getState().loadFromSession({});

    expect(useTextSettingsStore.getState().settings).toEqual(before);
    expect(useTextSettingsStore.getState().customized).toEqual(beforeCustomized);
  });
});
