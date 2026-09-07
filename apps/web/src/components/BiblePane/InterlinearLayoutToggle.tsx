import { useTranslation } from 'react-i18next';
import { settingsStore } from '../../stores/settingsStore';
import { useStore } from '../../hooks/useStore';

/**
 * Stacked / Inline switch for the interlinear.
 *
 * The setting has always existed, but only in Settings → Text Size, several
 * clicks away from the thing it changes — so in practice it did not exist. It
 * belongs next to the interlinear itself, in both places one is rendered: the
 * Bible pane's study toggle bar and the Study pane's Interlinear section.
 */
export function InterlinearLayoutToggle() {
  const { t } = useTranslation();
  const layout = useStore(settingsStore, () => settingsStore.interlinearLayout);

  return (
    <div class="interlinear-layout-toggle" role="group" aria-label={t('settings.textSize.interlinearLayout')}>
      {(['stacked', 'inline'] as const).map(value => (
        <button
          key={value}
          type="button"
          class={`interlinear-layout-toggle__btn${layout === value ? ' interlinear-layout-toggle__btn--active' : ''}`}
          aria-pressed={layout === value}
          onClick={() => settingsStore.setInterlinearLayout(value)}
        >
          {value === 'stacked' ? t('settings.textSize.interlinearStackedShort') : t('settings.textSize.interlinearInlineShort')}
        </button>
      ))}
    </div>
  );
}
