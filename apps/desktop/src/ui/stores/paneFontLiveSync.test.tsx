import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTextSettingsStore, getFontFamilyCSS, type PaneType } from './useTextSettingsStore';
import { usePreferencesStore, DEFAULT_TYPOGRAPHY } from './usePreferencesStore';

/**
 * Component-level check that a pane actually CONSUMES the store values that
 * usePreferencesStore's Typography section writes - the third symptom from
 * the bug report ("font-family selection does nothing"), and confirmation
 * that the whole chain is live (no restart needed).
 *
 * This intentionally mirrors the real inline-style pattern used by
 * BibleVerseList.tsx / CommentarySinglePanel.tsx / BookSinglePanel.tsx /
 * DictionarySinglePanel.tsx (all outside this task's file ownership) rather
 * than rendering one of those components directly - they pull in Bible pane
 * context, dockview panel APIs, and IPC-backed stores that would make this
 * test mostly about mocking unrelated machinery. The pattern under test here
 * - `useTextSettingsStore(state => state.getSettings(paneType))` driving
 * `--pane-font-size-<pane>` etc. inline - is copied verbatim from those
 * files' JSX.
 */
function TestPane({ paneType }: { paneType: PaneType }) {
  const settings = useTextSettingsStore((state) => state.getSettings(paneType));
  return (
    <div
      data-testid="pane"
      className={`pane-content-${paneType}`}
      style={
        {
          [`--pane-font-family-${paneType}`]: getFontFamilyCSS(settings.fontFamily),
          [`--pane-font-size-${paneType}`]: `${settings.fontSize}px`,
          [`--pane-line-height-${paneType}`]: settings.lineHeight
        } as React.CSSProperties
      }
    />
  );
}

describe('a pane consuming useTextSettingsStore reflects live Typography changes', () => {
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
    usePreferencesStore.setState({ typography: { ...DEFAULT_TYPOGRAPHY } });
  });

  afterEach(() => {
    document.documentElement.style.cssText = '';
  });

  it('an un-customized Bible pane updates its inline custom property when the Typography slider changes', () => {
    render(<TestPane paneType="bible" />);
    const pane = screen.getByTestId('pane');
    expect(pane.style.getPropertyValue('--pane-font-size-bible')).toBe('20px');

    act(() => {
      usePreferencesStore.getState().setTypography({ bibleFontSize: 34 });
    });

    // No remount, no page reload - same element, new value.
    expect(pane.style.getPropertyValue('--pane-font-size-bible')).toBe('34px');
  });

  it('the font-family picker reaches the pane, not just the CSS variable on <html>', () => {
    render(<TestPane paneType="bible" />);
    const pane = screen.getByTestId('pane');

    act(() => {
      usePreferencesStore.getState().setTypography({ bibleFontFamily: 'lora' });
    });

    expect(pane.style.getPropertyValue('--pane-font-family-bible')).toContain('Lora');
  });

  it('a pane the user explicitly customized in the Fonts section stops following Typography changes', () => {
    render(<TestPane paneType="dictionary" />);
    const pane = screen.getByTestId('pane');

    act(() => {
      useTextSettingsStore.getState().updateSettings('dictionary', { fontSize: 22 });
    });
    expect(pane.style.getPropertyValue('--pane-font-size-dictionary')).toBe('22px');

    act(() => {
      usePreferencesStore.getState().setTypography({ studyFontSize: 12 });
    });

    // Explicit per-pane override still wins - this is intended precedence,
    // not a regression of the fix above.
    expect(pane.style.getPropertyValue('--pane-font-size-dictionary')).toBe('22px');
  });
});
