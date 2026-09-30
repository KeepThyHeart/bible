/** `[−] 1.25× [+]`: steps through the speed presets the current source supports. */

import { useTranslation } from 'react-i18next';
import { audioStore } from '../../stores/audioStore';
import { useStore } from '../../hooks/useStore';
import { effectiveRate, stepRate } from '../../audio/audioPrefs';
import { formatRate } from './AudioControls';

export function AudioSpeedControl({ large }: { large?: boolean }) {
  const { t } = useTranslation();
  const rate = useStore(audioStore, () => audioStore.prefs.rate);
  const range = useStore(audioStore, () => audioStore.capabilities?.rate ?? null);
  const shown = range ? effectiveRate(rate, { rate: range }) : rate;
  const slower = stepRate(shown, -1, range) !== null;
  const faster = stepRate(shown, 1, range) !== null;
  return (
    <div class={`audio-speed${large ? ' audio-speed--large' : ''}`} role="group" aria-label={t('audio.speed.label')} data-testid="audio-speed">
      <button
        type="button"
        class="audio-speed__btn"
        disabled={!slower}
        aria-label={t('audio.speed.slower')}
        title={t('audio.speed.slower')}
        onClick={() => audioStore.stepRate(-1)}
      >
        <i class="fa-solid fa-minus" aria-hidden="true" />
      </button>
      <output class="audio-speed__value" aria-live="polite">
        <button
          type="button"
          class="audio-speed__reset"
          title={t('audio.speed.reset')}
          aria-label={`${formatRate(shown)}. ${t('audio.speed.reset')}`}
          onClick={() => audioStore.setPrefs({ rate: 1 })}
        >
          {formatRate(shown)}
        </button>
      </output>
      <button
        type="button"
        class="audio-speed__btn"
        disabled={!faster}
        aria-label={t('audio.speed.faster')}
        title={t('audio.speed.faster')}
        onClick={() => audioStore.stepRate(1)}
      >
        <i class="fa-solid fa-plus" aria-hidden="true" />
      </button>
    </div>
  );
}
