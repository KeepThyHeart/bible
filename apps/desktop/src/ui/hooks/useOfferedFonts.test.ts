import { describe, it, expect } from 'vitest';
import { groupOfferedFonts } from './useOfferedFonts';
import { AVAILABLE_FONT_FAMILIES, DEFAULT_TYPOGRAPHY, usePreferencesStore } from '../stores/usePreferencesStore';
import { AVAILABLE_FONTS, getFontFamilyCSS } from '../stores/useTextSettingsStore';

const entries = AVAILABLE_FONT_FAMILIES.map(f => ({ ...f, value: f.id }));

describe('curated font catalogue', () => {
  it('keeps every id that settings may already hold', () => {
    for (const id of ['system', 'georgia', 'times', 'palatino', 'garamond', 'lora', 'merriweather', 'eb-garamond']) {
      expect(AVAILABLE_FONT_FAMILIES.some(f => f.id === id)).toBe(true);
    }
    expect(AVAILABLE_FONT_FAMILIES.some(f => f.id === 'candara')).toBe(true);
    expect(AVAILABLE_FONTS.map(f => f.name)).toEqual(expect.arrayContaining(['Georgia', 'Merriweather', 'Garamond', 'Times New Roman', 'Crimson Text', 'Libre Baskerville', 'Candara']));
  });

  it('every stack ends in a generic family, so a missing face degrades cleanly', () => {
    for (const f of AVAILABLE_FONT_FAMILIES) expect(f.stack).toMatch(/(serif|sans-serif)$/);
  });

  it('shows only installed faces, grouped, with bundled ones always present', () => {
    const { groups } = groupOfferedFonts(entries, undefined, family => family === 'Candara');
    expect(groups.general.map(f => f.value)).toEqual(['system']);
    expect(groups.sans.map(f => f.value)).toEqual(['candara']);
    const serif = groups.serif.map(f => f.value);
    expect(serif).toEqual(expect.arrayContaining(['merriweather', 'crimson-text', 'noto-serif']));
    expect(serif).not.toContain('cambria');
    expect(serif).not.toContain('georgia');
  });

  it('keeps a saved choice that is not installed here, flagged missing', () => {
    const { groups, missing } = groupOfferedFonts(entries, 'cambria', () => false);
    expect(missing?.value).toBe('cambria');
    expect(groups.serif.some(f => f.value === 'cambria')).toBe(false);
  });

  it('a saved font that is unknown to this machine survives session loading and still resolves a stack', () => {
    const store = usePreferencesStore.getState();
    store.setTypography({ bibleFontFamily: 'candara' });
    const data = store.getSessionData();
    store.resetTypography();
    store.loadFromSession(data);
    expect(usePreferencesStore.getState().typography.bibleFontFamily).toBe('candara');
    expect(getFontFamilyCSS('Candara')).toMatch(/Candara.*sans-serif$/);
    store.setTypography({ bibleFontFamily: DEFAULT_TYPOGRAPHY.bibleFontFamily });
  });
});
