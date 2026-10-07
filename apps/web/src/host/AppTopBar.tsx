import { useTranslation } from 'react-i18next';
import { appRegistry, backToStudy } from './appHost';
import { resolveLabel } from './appNavEntries';
import { AppSwitchSlot } from './AppSwitchSlot';

/** Phone top bar for an app without chrome of its own: "<- Study", the app's title and the switcher. */
export function AppTopBar({ id }: { id: string }) {
  const { t } = useTranslation();
  const desc = appRegistry.get(id);
  return (
    <header class="app-topbar">
      <button type="button" class="app-topbar__back" onClick={() => { void backToStudy(); }}>
        <i class="fa-solid fa-chevron-left rtl-mirror" aria-hidden="true" />
        {t('apps.backToStudy', 'Back to Study')}
      </button>
      <span class="app-topbar__title">{desc ? resolveLabel((k, f) => t(k, f), desc.title) : id}</span>
      <AppSwitchSlot className="app-topbar__switch" />
    </header>
  );
}
