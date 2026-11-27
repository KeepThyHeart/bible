import { describe, it, expect, beforeEach } from 'vitest';
import { usePreferencesStore, sanitizeScrollbarSize } from './usePreferencesStore';

describe('scrollbar size preference', () => {
  beforeEach(() => {
    usePreferencesStore.getState().setScrollbarSize('standard');
  });

  it('sanitizes unknown values to standard', () => {
    expect(sanitizeScrollbarSize('large')).toBe('large');
    expect(sanitizeScrollbarSize('huge')).toBe('standard');
    expect(sanitizeScrollbarSize(undefined)).toBe('standard');
  });

  it('sets and clears the data attribute on the root element', () => {
    usePreferencesStore.getState().setScrollbarSize('large');
    expect(document.documentElement.getAttribute('data-scrollbar-size')).toBe('large');
    usePreferencesStore.getState().setScrollbarSize('standard');
    expect(document.documentElement.hasAttribute('data-scrollbar-size')).toBe(false);
  });

  it('round-trips through the session data', () => {
    usePreferencesStore.getState().setScrollbarSize('large');
    const data = usePreferencesStore.getState().getSessionData();
    expect(data.scrollbarSize).toBe('large');
    usePreferencesStore.getState().setScrollbarSize('standard');
    usePreferencesStore.getState().loadFromSession(data);
    expect(usePreferencesStore.getState().scrollbarSize).toBe('large');
  });
});
