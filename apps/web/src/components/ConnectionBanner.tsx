import { useTranslation } from 'react-i18next';
import { connectionStore } from '../stores/connectionStore';
import { useStore } from '../hooks/useStore';

export function ConnectionBanner() {
  const { t } = useTranslation();
  const error = useStore(connectionStore, () => connectionStore.error);

  if (!error) return null;

  return (
    <div class="connection-banner">
      <i class="fa-solid fa-triangle-exclamation" />
      <span class="connection-banner__message">{error}</span>
      <button
        class="connection-banner__dismiss"
        onClick={() => connectionStore.dismiss()}
        title={t('connectionBanner.dismiss')}
      >
        <i class="fa-solid fa-xmark" />
      </button>
    </div>
  );
}
