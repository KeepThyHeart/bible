/**
 * "Continue to the next chapter" and the repeat control. The same two settings appear in the
 * player's playlist section and in quick settings (`prefix` keeps their test ids apart).
 */

import { useTranslation } from 'react-i18next';
import type { PassageLoop } from '@bible/audio';
import { audioStore } from '../audioStore';
import { useStore } from '../../../hooks/useStore';

const LOOPS: PassageLoop[] = ['once', 'list', 'passage'];

export function PassageOptions({ prefix, showHint }: { prefix: 'audio' | 'audio-quick'; showHint?: boolean }) {
  const { t } = useTranslation();
  const prefs = useStore(audioStore, () => audioStore.prefs);
  const queue = useStore(audioStore, () => audioStore.queue);
  const labelId = `${prefix}-loop-label`;
  const cont = prefs.continueAfterChapter === 'next-chapter';
  return (
    <div class="audio-passage-options">
      <label class="audio-passage-options__continue">
        <input
          type="checkbox"
          checked={cont}
          data-testid={`${prefix}-continue`}
          onChange={e => audioStore.setContinueAfterChapter((e.target as HTMLInputElement).checked)}
        />
        <span>{t('audio.continue.label')}</span>
      </label>
      {showHint && queue?.kind === 'list' && <div class="audio-passage-options__hint">{t('audio.continue.listHint')}</div>}
      <div class="audio-panel__row">
        <span class="audio-panel__label" id={labelId}>{t('audio.loop.label')}</span>
        <div class="audio-segmented" role="radiogroup" aria-labelledby={labelId} data-testid={`${prefix}-loop`}>
          {LOOPS.map(loop => (
            <button
              key={loop}
              type="button"
              role="radio"
              aria-checked={prefs.passageLoop === loop}
              class={`audio-segmented__btn${prefs.passageLoop === loop ? ' audio-segmented__btn--active' : ''}`}
              data-testid={`${prefix}-loop-${loop}`}
              onClick={() => audioStore.setPassageLoop(loop)}
            >
              {t(`audio.loop.${loop}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
