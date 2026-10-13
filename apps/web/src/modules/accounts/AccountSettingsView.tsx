/** The lazy `preferences:account` view (see `binding.ts`): Settings > Account. */
import { useEffect } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { accountStore, } from './instance';
import { isSignedIn } from './accountStore';
import { SignedInView, SignedOutView, StatusBadge, useAccountState } from './AccountScreens';
import { accountLabels } from './labels';

export default function AccountSettingsView() {
  const { t } = useTranslation();
  const s = useAccountState();
  useEffect(() => {
    void accountStore.start().then(() => accountStore.loadAccount());
  }, []);
  if (!s.available) {
    return <div class="settings-panel__section" data-section="account"><p class="kth-account__muted">{t('accounts.unavailable')}</p></div>;
  }
  return (
    <div class="settings-panel__section kth-account__stack" data-section="account" data-testid="accounts-settings">
      <div class="kth-account__row kth-account__row--between">
        <h2 class="kth-account__title">{t('accounts.title')}</h2>
        <StatusBadge status={s.status} labels={accountLabels(t).syncStatus} />
      </div>
      {isSignedIn(s.status) ? <SignedInView /> : <SignedOutView />}
    </div>
  );
}
