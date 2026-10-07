import { describe, it, expect, beforeEach } from 'vitest';
import { usePreferencesStore } from './usePreferencesStore';
import { getDesktopSettingsStore } from '../settings/desktopSettings';

describe('usePreferencesStore: app switcher prefs', () => {
  beforeEach(() => usePreferencesStore.setState({ appSwitcher: 'auto', appOrder: [], appHidden: [] }));

  it('defaults to auto, empty order and nothing hidden', () => {
    expect(usePreferencesStore.getState().getSessionData()).toMatchObject({ appSwitcher: 'auto', appOrder: [], appHidden: [] });
  });

  it('round-trips through the session blob', () => {
    const s = usePreferencesStore.getState();
    s.setAppSwitcher('rail');
    s.setAppOrder(['b', 'study']);
    s.setAppHidden(['b']);
    const blob = JSON.parse(JSON.stringify(usePreferencesStore.getState().getSessionData()));
    usePreferencesStore.setState({ appSwitcher: 'auto', appOrder: [], appHidden: [] });
    usePreferencesStore.getState().loadFromSession(blob);
    expect(usePreferencesStore.getState()).toMatchObject({ appSwitcher: 'rail', appOrder: ['b', 'study'], appHidden: ['b'] });
  });

  it('falls back per field on garbage and old sessions', () => {
    usePreferencesStore.getState().loadFromSession({ appSwitcher: 'weird', appOrder: 'x', appHidden: [1, 'a', 'a', ''] });
    expect(usePreferencesStore.getState()).toMatchObject({ appSwitcher: 'auto', appOrder: [], appHidden: ['a'] });
    usePreferencesStore.getState().loadFromSession({});
    expect(usePreferencesStore.getState().appSwitcher).toBe('auto');
  });

  it('is editable through the desktop settings registry and mirrors back', () => {
    const store = getDesktopSettingsStore();
    store.set('appSwitcher', 'none');
    store.set('appOrder', ['x']);
    expect(usePreferencesStore.getState()).toMatchObject({ appSwitcher: 'none', appOrder: ['x'] });
    usePreferencesStore.getState().setAppSwitcher('rail');
    expect(store.getSnapshot().appSwitcher).toBe('rail');
  });
});
