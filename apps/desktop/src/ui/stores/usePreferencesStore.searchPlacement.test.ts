/**
 * Search tabs (task 0210): the "where do search results open" preference.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePreferencesStore, sanitizeSearchResultsPlacement } from './usePreferencesStore';
import { getSessionSerializers } from './helpers/sessionRegistry';
import * as notifier from './helpers/sessionNotifier';

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.cssText = '';
  usePreferencesStore.setState({ searchResultsPlacement: 'below' });
});

describe('searchResultsPlacement preference', () => {
  it('defaults to below', () => {
    // A store created fresh (module default), not the one reset by beforeEach.
    expect(usePreferencesStore.getInitialState().searchResultsPlacement).toBe('below');
  });

  it('setSearchResultsPlacement sets it and marks the session dirty so it persists', () => {
    const dirty = vi.spyOn(notifier, 'markSessionDirty');
    usePreferencesStore.getState().setSearchResultsPlacement('right');
    expect(usePreferencesStore.getState().searchResultsPlacement).toBe('right');
    expect(dirty).toHaveBeenCalled();
    usePreferencesStore.getState().setSearchResultsPlacement('below');
    expect(usePreferencesStore.getState().searchResultsPlacement).toBe('below');
    dirty.mockRestore();
  });

  it('setting an unknown value falls back to below', () => {
    usePreferencesStore.getState().setSearchResultsPlacement('right');
    usePreferencesStore.getState().setSearchResultsPlacement('sideways' as never);
    expect(usePreferencesStore.getState().searchResultsPlacement).toBe('below');
  });

  it('sanitizeSearchResultsPlacement keeps tab and right and maps everything else to below', () => {
    expect(sanitizeSearchResultsPlacement('right')).toBe('right');
    expect(sanitizeSearchResultsPlacement('tab')).toBe('tab');
    expect(sanitizeSearchResultsPlacement('below')).toBe('below');
    for (const raw of ['left', '', 'RIGHT', 'Tab', undefined, null, 3, {}, ['right']]) {
      expect(sanitizeSearchResultsPlacement(raw)).toBe('below');
    }
  });

  it('round trips through getSessionData / loadFromSession', () => {
    usePreferencesStore.getState().setSearchResultsPlacement('right');
    const saved = usePreferencesStore.getState().getSessionData();
    expect(saved.searchResultsPlacement).toBe('right');

    usePreferencesStore.setState({ searchResultsPlacement: 'below' });
    usePreferencesStore.getState().loadFromSession(saved);

    expect(usePreferencesStore.getState().searchResultsPlacement).toBe('right');
  });

  it('is part of the registered preferences session serializer', () => {
    usePreferencesStore.getState().setSearchResultsPlacement('right');
    const serialized = getSessionSerializers().get('preferences')!() as { searchResultsPlacement: string };
    expect(serialized.searchResultsPlacement).toBe('right');
  });

  it('loadFromSession with a missing or corrupt value uses below', () => {
    usePreferencesStore.setState({ searchResultsPlacement: 'right' });
    usePreferencesStore.getState().loadFromSession({});
    expect(usePreferencesStore.getState().searchResultsPlacement).toBe('below');

    usePreferencesStore.setState({ searchResultsPlacement: 'right' });
    usePreferencesStore.getState().loadFromSession({ searchResultsPlacement: 'diagonal' });
    expect(usePreferencesStore.getState().searchResultsPlacement).toBe('below');
  });

  it('loadFromSession restores right', () => {
    usePreferencesStore.getState().loadFromSession({ searchResultsPlacement: 'right' });
    expect(usePreferencesStore.getState().searchResultsPlacement).toBe('right');
  });

  it('tab is a valid stored preference and survives the session round trip', () => {
    usePreferencesStore.getState().setSearchResultsPlacement('tab');
    expect(usePreferencesStore.getState().searchResultsPlacement).toBe('tab');
    usePreferencesStore.setState({ searchResultsPlacement: 'below' });
    usePreferencesStore.getState().loadFromSession({ searchResultsPlacement: 'tab' });
    expect(usePreferencesStore.getState().searchResultsPlacement).toBe('tab');
  });
});
