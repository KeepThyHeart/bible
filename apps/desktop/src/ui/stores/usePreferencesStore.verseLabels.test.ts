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

describe('reading width preference', () => {
  beforeEach(() => usePreferencesStore.getState().resetTypography());

  it('defaults to medium, which keeps the old 48rem / 56rem caps', () => {
    expect(usePreferencesStore.getState().typography.readingWidth).toBe('medium');
    expect(document.documentElement.style.getPropertyValue('--bible-max-width')).toBe('48rem');
    expect(document.documentElement.style.getPropertyValue('--study-max-width')).toBe('56rem');
  });

  it('publishes the caps as CSS variables and "full" removes the cap', () => {
    usePreferencesStore.getState().setTypography({ readingWidth: 'wide' });
    expect(document.documentElement.style.getPropertyValue('--bible-max-width')).toBe('64rem');
    usePreferencesStore.getState().setTypography({ readingWidth: 'full' });
    expect(document.documentElement.style.getPropertyValue('--bible-max-width')).toBe('none');
  });

  it('drops an unknown saved width', () => {
    const data = usePreferencesStore.getState().getSessionData();
    usePreferencesStore.getState().loadFromSession({ ...data, typography: { ...data.typography, readingWidth: 'huge' as never } });
    expect(usePreferencesStore.getState().typography.readingWidth).toBe('medium');
  });
});
