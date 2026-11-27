import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/preact';

vi.mock('react-i18next', async importOriginal => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}${JSON.stringify(o)}` : k), i18n: { language: 'en' } }),
}));

import { audioStore } from '../audioStore';
import { bibleStore } from '../../../stores/bibleStore';
import { buildUiRig, flush, openChapter } from '../lib/uiRig';
import { offlineAudio } from '../lib/offlineAudio';
import { AudioOfflineChoices, AudioOfflineHint } from './AudioOfflineChoices';

const setOnline = (v: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => v });

afterEach(() => { cleanup(); audioStore.reset(); offlineAudio.set('KJV', []); offlineAudio.set('ESV', []); setOnline(true); vi.restoreAllMocks(); });

describe('AudioOfflineChoices', () => {
  it('lists each translation with saved audio; nothing when none is saved', () => {
    const { container } = render(<AudioOfflineChoices variant="settings" />);
    expect(container.textContent).toBe('');
    cleanup();
    offlineAudio.set('KJV', [1, 43]);
    render(<AudioOfflineChoices variant="settings" />);
    expect(screen.getByTestId('audio-offline-KJV').textContent).toContain('KJV');
  });

  it('pressing one moves to a saved book of that translation and plays', async () => {
    buildUiRig({});
    await openChapter(43, 3);
    await flush();
    offlineAudio.set('KJV', [1]);
    const nav = vi.spyOn(bibleStore, 'navigateTo');
    const play = vi.spyOn(audioStore, 'play').mockResolvedValue(undefined as never);
    render(<AudioOfflineChoices variant="settings" />);
    fireEvent.click(screen.getByTestId('audio-offline-KJV'));
    await waitFor(() => expect(play).toHaveBeenCalled());
    expect(nav).toHaveBeenCalledWith(1, 1, undefined, expect.objectContaining({ tabId: bibleStore.activeTabId }));
  });

  it('under the player notice only while offline', () => {
    offlineAudio.set('KJV', [1]);
    audioStore.notice = { key: 'audio.notice.noAudio', tone: 'info', actions: [] };
    setOnline(true);
    const { unmount } = render(<AudioOfflineHint />);
    expect(screen.queryByTestId('audio-offline-status')).toBeNull();
    unmount();
    setOnline(false);
    render(<AudioOfflineHint />);
    expect(screen.getByTestId('audio-offline-status')).toBeTruthy();
  });
});
