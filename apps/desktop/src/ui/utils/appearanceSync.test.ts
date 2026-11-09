import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { getMainActiveTranslation } from './mainActiveTranslation';
import { startAppearanceFollower, startAppearancePublisher } from './appearanceSync';

type Win = { electron?: { window?: Record<string, unknown> } };

describe('appearanceSync', () => {
  const original = (window as unknown as Win).electron;
  beforeEach(() => {
    usePreferencesStore.getState().loadFromSession({});
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => { (window as unknown as Win).electron = original; });

  it('the follower applies the stored appearance and later changes, without saving anything', async () => {
    let listener: ((a: Record<string, unknown>) => void) | undefined;
    (window as unknown as Win).electron = {
      window: {
        getAppearance: vi.fn().mockResolvedValue({ theme: 'sepia', globalFontScale: 1.2, uiControlFontSize: 14, activeTranslation: 'ASV' }),
        onAppearanceChanged: (cb: (a: Record<string, unknown>) => void) => { listener = cb; },
      },
    };
    startAppearanceFollower();
    await vi.waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('sepia'));
    expect(document.documentElement.style.getPropertyValue('--global-font-scale')).toBe('1.2');
    expect(getMainActiveTranslation()).toBe('ASV');
    listener!({ theme: 'midnight', activeTranslation: 'KJV' });
    expect(getMainActiveTranslation()).toBe('KJV');
    expect(document.documentElement.getAttribute('data-theme')).toBe('midnight');
  });

  it('the publisher sends the appearance now and when it changes, not on unrelated changes', () => {
    const broadcastAppearance = vi.fn().mockResolvedValue({ success: true });
    (window as unknown as Win).electron = { window: { broadcastAppearance } };
    startAppearancePublisher();
    expect(broadcastAppearance).toHaveBeenCalledTimes(1);
    usePreferencesStore.getState().setTheme('dark');
    expect(broadcastAppearance).toHaveBeenCalledTimes(2);
    expect(broadcastAppearance.mock.calls[1][0]).toMatchObject({ theme: 'dark' });
    usePreferencesStore.getState().setAdvancedPaneManagerEnabled(true);
    expect(broadcastAppearance).toHaveBeenCalledTimes(2);
  });
});
