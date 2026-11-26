/** Shown while the tab being read is not the one in front: where it is, and a way back to it. */

import { useTranslation } from 'react-i18next';
import { audioStore } from '../audioStore';
import { bibleStore } from '../../../stores/bibleStore';
import { useStore } from '../../../hooks/useStore';
import { useNowPlaying } from '../hooks/useNowPlaying';

export function useElsewhere(): boolean {
  const status = useStore(audioStore, () => audioStore.status);
  const playing = useStore(audioStore, () => audioStore.playingTabId);
  const active = useStore(bibleStore, () => bibleStore.activeTabId);
  return status !== 'idle' && !!playing && playing !== active;
}

export function AudioElsewhere({ strip }: { strip?: boolean }) {
  const { t } = useTranslation();
  const elsewhere = useElsewhere();
  const now = useNowPlaying();
  if (!elsewhere) return null;
  return (
    <div class={strip ? 'audio-elsewhere audio-elsewhere--strip' : 'audio-elsewhere'} data-testid="audio-elsewhere">
      <span class="audio-elsewhere__text">{t('audio.elsewhere.label', { ref: now.chapterLabel || now.refLabel, module: now.moduleAbbr ?? '' })}</span>
      <button type="button" class="audio-panel__more" data-testid="audio-goto-tab" onClick={() => audioStore.revealPlayingTab()}>
        {t('audio.elsewhere.goto')}
      </button>
    </div>
  );
}
