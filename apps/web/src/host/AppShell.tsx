import { useEffect, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { useTranslation } from 'react-i18next';
import { DirectionProvider } from '@bible/ui';
import { uiDirectionFor } from '../i18n';
import type { ShellContext } from '../boot/shellContext';
import { appRegistry } from './appHost';
import { AppStage } from './AppStage';
import { useAppSwitchKeys } from './useAppSwitchKeys';
import { useReadable } from './useReadable';

/** Mounts the Presenter's clicker keys (a lazy chunk) while a session is live, whichever app is shown. */
function PresenterKeysHost() {
  const apps = useReadable(appRegistry.state);
  const busy = apps.apps.some((a) => a.item.id === 'present' && a.busy);
  const [Keys, setKeys] = useState<ComponentType | null>(null);
  useEffect(() => {
    if (!busy || Keys) return;
    let live = true;
    void import('../components/Present/PresenterKeys').then((m) => {
      if (live) setKeys(() => m.PresenterKeys);
    });
    return () => {
      live = false;
    };
  }, [busy, Keys]);
  return busy && Keys ? <Keys /> : null;
}

/** The shell: direction provider, app stage and the shell-wide shortcuts. */
export function AppShell(_props: { ctx: ShellContext }) {
  useAppSwitchKeys();
  // UI direction for shared `@bible/ui` components (task 0076); re-renders on language change.
  const { i18n } = useTranslation();
  const locale = i18n.language || 'en';
  return (
    <DirectionProvider value={{ ui: uiDirectionFor(locale), locale }}>
      <AppStage />
      <PresenterKeysHost />
    </DirectionProvider>
  );
}
