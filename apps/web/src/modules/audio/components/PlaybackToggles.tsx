/**
 * Repeat and "continue to the next chapter" as two on/off switches (like an "Autoplay" switch),
 * captioned on the phone: the switch shape says on or off, so no icon has to. Hovering shows what
 * each does (title); pressing one flashes what it now does, since a phone has no hover.
 * Repeat is loop "list": it repeats what is being read (the typed list, the chapter, or with
 * Continue on the whole book). A stored "passage" also shows as on.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { audioStore } from '../audioStore';
import { useStore } from '../../../hooks/useStore';

export function PlaybackToggles({ large }: { large?: boolean }) {
  const { t } = useTranslation();
  const prefs = useStore(audioStore, () => audioStore.prefs);
  const queue = useStore(audioStore, () => audioStore.queue);
  const [hint, setHint] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const flash = (text: string) => {
    setHint(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHint(''), 1800);
  };

  const repeat = prefs.passageLoop !== 'once';
  const cont = prefs.continueAfterChapter === 'next-chapter';
  // A typed list decides its own chapters, so "continue" does nothing there.
  const typed = queue?.kind === 'list';
  const cls = `audio-btn audio-switch-btn${large ? ' audio-tool' : ''}`;

  return (
    <div class="audio-toggles">
      <button
        type="button"
        class={cls}
        role="switch"
        aria-checked={repeat}
        title={t('audio.loop.label')}
        aria-label={t('audio.loop.label')}
        data-testid="audio-repeat"
        onClick={() => {
          audioStore.setPassageLoop(repeat ? 'once' : 'list');
          flash(repeat ? t('audio.loop.off') : t('audio.loop.on'));
        }}
      >
        <span class={`audio-switch${repeat ? ' audio-switch--on' : ''}`} aria-hidden="true"><span class="audio-switch__thumb" /></span>
        {large && <span class="audio-tool__caption">{t('audio.loop.short')}</span>}
      </button>
      <button
        type="button"
        class={cls}
        role="switch"
        aria-checked={cont}
        disabled={typed}
        title={typed ? t('audio.continue.listHint') : t('audio.continue.label')}
        aria-label={t('audio.continue.label')}
        data-testid="audio-continue"
        onClick={() => {
          audioStore.setContinueAfterChapter(!cont);
          flash(cont ? t('audio.continue.off') : t('audio.continue.on'));
        }}
      >
        <span class={`audio-switch${cont ? ' audio-switch--on' : ''}`} aria-hidden="true"><span class="audio-switch__thumb" /></span>
        {large && <span class="audio-tool__caption">{t('audio.continue.short')}</span>}
      </button>
      <span class={`audio-toggles__hint${hint ? ' audio-toggles__hint--shown' : ''}`} role="status" aria-live="polite">{hint}</span>
    </div>
  );
}

