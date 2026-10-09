import { useTranslation } from 'react-i18next';
import { AppRail, DirectionProvider } from '@bible/ui';
import { uiDirectionFor } from '../i18n';
import type { ShellContext } from '../boot/shellContext';
import { appHost, openApp, prefetchApp } from './appHost';
import { SlotOutlet, shellOverlays } from './slots';
import { useNavEntries } from './appNavEntries';
import { useNavItems, useRailVisible } from './navPrefs';
import { AppStage } from './AppStage';
import { useAppSwitchKeys } from './useAppSwitchKeys';
import { useReadable } from './useReadable';

/**
 * `[AppRail][stage]`. The rail is a conditional *sibling* of the stage wrapper,
 * so showing or hiding it never changes the stage's parent or position and
 * Study (and every kept-alive app) is not remounted.
 */
function AppRailSlot() {
  const { t } = useTranslation();
  const visible = useRailVisible();
  const items = useNavItems('rail');
  const entries = useNavEntries(items);
  const { activeId } = useReadable(appHost);
  if (!visible) return null;
  return (
    <AppRail
      className="app-shell__rail"
      items={entries}
      activeId={activeId}
      onSelect={(id) => { void openApp(id); }}
      onPrefetch={prefetchApp}
      labels={{ railLabel: t('apps.rail.label', 'Apps') }}
    />
  );
}

/** The shell: direction provider, `[AppRail][AppStage]` and the shell-wide shortcuts. */
export function AppShell(_props: { ctx: ShellContext }) {
  useAppSwitchKeys();
  // UI direction for shared `@bible/ui` components (task 0076); re-renders on language change.
  const { i18n } = useTranslation();
  const locale = i18n.language || 'en';
  return (
    <DirectionProvider value={{ ui: uiDirectionFor(locale), locale }}>
      <div class="app-shell">
        <AppRailSlot />
        <div class="app-shell__stage">
          <AppStage />
        </div>
      </div>
      {/* Shell-wide UI of active feature modules (e.g. the Presenter's clicker keys). */}
      <SlotOutlet slot={shellOverlays} />
    </DirectionProvider>
  );
}
