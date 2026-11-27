import { describe, it, expect, beforeEach } from 'vitest';
import { usePreferencesStore, DEFAULT_TYPOGRAPHY } from './usePreferencesStore';

describe('verse label preference', () => {
  beforeEach(() => usePreferencesStore.getState().resetTypography());

  it('defaults to the bare number', () => {
    expect(DEFAULT_TYPOGRAPHY.verseLabelMode).toBe('number');
    expect(usePreferencesStore.getState().typography.verseLabelMode).toBe('number');
  });

  it('round-trips through the session and drops unknown values', () => {
    usePreferencesStore.getState().setTypography({ verseLabelMode: 'bookChapterVerse' });
    const data = usePreferencesStore.getState().getSessionData();
    usePreferencesStore.getState().resetTypography();
    usePreferencesStore.getState().loadFromSession(data);
    expect(usePreferencesStore.getState().typography.verseLabelMode).toBe('bookChapterVerse');

    usePreferencesStore.getState().loadFromSession({ ...data, typography: { ...data.typography, verseLabelMode: 'bogus' as never } });
    expect(usePreferencesStore.getState().typography.verseLabelMode).toBe('number');
  });
});

describe('text width preference (one per display mode)', () => {
  beforeEach(() => usePreferencesStore.getState().resetTypography());
  const css = (name: string) => document.documentElement.style.getPropertyValue(name);

  it('defaults every mode to medium, which keeps the old 48rem / 56rem caps', () => {
    const { standardWidth, readingWidth, studyWidth } = usePreferencesStore.getState().typography;
    expect([standardWidth, readingWidth, studyWidth]).toEqual(['medium', 'medium', 'medium']);
    expect(css('--standard-max-width')).toBe('48rem');
    expect(css('--reading-max-width')).toBe('48rem');
    expect(css('--study-max-width')).toBe('56rem');
  });

  it('sets each mode on its own: Standard can fill the pane while Reading keeps its cap', () => {
    usePreferencesStore.getState().setTypography({ standardWidth: 'full' });
    expect(css('--standard-max-width')).toBe('none');
    expect(css('--reading-max-width')).toBe('48rem');
    expect(css('--study-max-width')).toBe('56rem');
    usePreferencesStore.getState().setTypography({ readingWidth: 'narrow', studyWidth: 'wide' });
    expect(css('--reading-max-width')).toBe('36rem');
    expect(css('--study-max-width')).toBe('72rem');
  });

  it('drops an unknown saved width', () => {
    const data = usePreferencesStore.getState().getSessionData();
    usePreferencesStore.getState().loadFromSession({ ...data, typography: { ...data.typography, standardWidth: 'huge' as never } });
    expect(usePreferencesStore.getState().typography.standardWidth).toBe('medium');
  });

  it('gives all three modes the single width a pre-release profile saved', () => {
    const data = usePreferencesStore.getState().getSessionData();
    const { standardWidth: _s, studyWidth: _t, ...legacy } = data.typography;
    usePreferencesStore.getState().loadFromSession({ ...data, typography: { ...legacy, readingWidth: 'wide' } as never });
    const { standardWidth, readingWidth, studyWidth } = usePreferencesStore.getState().typography;
    expect([standardWidth, readingWidth, studyWidth]).toEqual(['wide', 'wide', 'wide']);
  });
});
