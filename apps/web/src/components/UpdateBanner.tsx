import { useTranslation } from 'react-i18next';
import { updateStore } from '../stores/updateStore';
import { useStore } from '../hooks/useStore';

/** "A new version is ready" prompt, shown only when the update mode is `prompt`. */
export function UpdateBanner() {
  const { t } = useTranslation();
  const available = useStore(updateStore, () => updateStore.available);

  if (!available) return null;

  return (
    <div class="update-banner" role="status" data-testid="update-banner">
      <i class="fa-solid fa-circle-arrow-up" />
      <span class="update-banner__message">{t('updateBanner.message')}</span>
      <button class="update-banner__action" onClick={() => window.location.reload()}>
        {t('updateBanner.reload')}
      </button>
      <button
        class="update-banner__dismiss"
        onClick={() => updateStore.setAvailable(false)}
        title={t('updateBanner.later')}
      >
        <i class="fa-solid fa-xmark" />
      </button>
    </div>
  );
}
