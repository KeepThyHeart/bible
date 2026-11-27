/**
 * The recorded audio saved on this device, as one button per translation ("ESV · Genesis, John"):
 * pressing one switches the tab to that translation (and to a saved book, if the current one is not
 * saved) and plays. Offline, the player shows it under its notice, so a reader on the wrong
 * translation or book finds what can play; the settings list it at any time.
 */
import { useEffect, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { audioStore } from '../audioStore';
import { useStore } from '../../../hooks/useStore';
import { bibleStore } from '../../../stores/bibleStore';
import { moduleStore } from '../../../stores/moduleStore';
import { offlineAudio, isOffline } from '../lib/offlineAudio';

/** Re-renders when the browser goes on- or offline. */
export function useOffline(): boolean {
  const [off, setOff] = useState(isOffline());
  useEffect(() => {
    const on = () => setOff(isOffline());
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on); };
  }, []);
  return off;
}

const MAX_NAMES = 3;

export function AudioOfflineChoices({ variant }: { variant: 'status' | 'settings' }) {
  const { t } = useTranslation();
  const byModule = useStore(offlineAudio, () => offlineAudio.byModule);
  const entries = Object.entries(byModule).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return null;

  const names = (books: number[]) => {
    const shown = books.slice(0, MAX_NAMES).map(b => moduleStore.getBookName(b) || String(b)).join(', ');
    return books.length > MAX_NAMES ? t('audio.offline.more', { names: shown, count: books.length - MAX_NAMES }) : shown;
  };

  const play = async (module: string, books: number[]) => {
    const tabId = audioStore.targetTabId ?? audioStore.playingTabId ?? bibleStore.activeTabId;
    const tab = bibleStore.tabs.find(x => x.id === tabId);
    if (!tab || !tabId) return;
    audioStore.clearNotice();
    if (tab.moduleAbbr !== module) await bibleStore.setTabTranslation(tabId, module);
    const now = bibleStore.tabs.find(x => x.id === tabId);
    if (!now?.book || !books.includes(now.book)) await bibleStore.navigateTo(books[0], 1, undefined, { tabId });
    void audioStore.play(tabId);
  };

  return (
    <div class={`audio-offline audio-offline--${variant}`} data-testid={`audio-offline-${variant}`}>
      <span class="audio-offline__label">{t('audio.offline.saved')}</span>
      <ul class="audio-offline__list">
        {entries.map(([module, books]) => (
          <li key={module}>
            <button type="button" class="audio-offline__btn" onClick={() => { void play(module, books); }} data-testid={`audio-offline-${module}`}>
              <i class="fa-solid fa-circle-down" aria-hidden="true" />
              <span><strong>{module}</strong> · {names(books)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Under the player's notice, only while offline. */
export function AudioOfflineHint() {
  const offline = useOffline();
  const notice = useStore(audioStore, () => audioStore.notice);
  if (!offline || !notice) return null;
  return <AudioOfflineChoices variant="status" />;
}
