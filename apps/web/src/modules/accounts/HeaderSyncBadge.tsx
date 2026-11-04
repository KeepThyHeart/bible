/** The header's sync badge (`headerItems`): the status at a glance; a click opens the account dialog. */
import { useMemo } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { accountStore } from './instance';
import { StatusBadge, useAccountState } from './AccountScreens';
import { accountLabels } from './labels';

export function HeaderSyncBadge() {
  const { t } = useTranslation();
  const s = useAccountState();
  const labels = useMemo(() => accountLabels(t).syncStatus, [t]);
  if (!s.available) return null;
  return (
    <span class="kth-accounts-header-badge" data-testid="accounts-header-badge">
      <StatusBadge status={s.status} labels={labels} onClick={() => accountStore.open()} />
    </span>
  );
}
