import { describe, it, expect, beforeEach } from 'vitest';
import { contrastText, dismissedBannerIds, parseBanners, pickText, rememberDismissed } from './siteBanners';

describe('pickText', () => {
  const m = { fr: 'Salut', en: 'Hi', de: 'Hallo' };
  it('uses a plain string as is', () => expect(pickText('Hi', 'fr')).toBe('Hi'));
  it('picks the UI language, then its base language', () => {
    expect(pickText(m, 'fr')).toBe('Salut');
    expect(pickText(m, 'de-AT')).toBe('Hallo');
  });
  it('falls back to en, then the first entry', () => {
    expect(pickText(m, 'ja')).toBe('Hi');
    expect(pickText({ fr: 'Salut', de: 'Hallo' }, 'ja')).toBe('Salut');
  });
});

describe('contrastText', () => {
  it('picks black on light and white on dark', () => {
    expect(contrastText('#fde68a')).toBe('#000');
    expect(contrastText('#1e3a8a')).toBe('#fff');
    expect(contrastText('rgb(250,250,250)')).toBe('#000');
    expect(contrastText(undefined)).toBe('#fff');
  });
});

describe('parseBanners / dismissal', () => {
  beforeEach(() => localStorage.clear());
  it('skips malformed entries', () => {
    expect(parseBanners([{ id: 'a', message: 'x', dismissible: false }, { id: 1 }, null])).toHaveLength(1);
    expect(parseBanners('nope')).toEqual([]);
  });
  it('remembers dismissals by id', () => {
    expect(dismissedBannerIds()).toEqual([]);
    rememberDismissed('a');
    rememberDismissed('a');
    rememberDismissed('b');
    expect(dismissedBannerIds()).toEqual(['a', 'b']);
  });
});
