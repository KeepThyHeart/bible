/**
 * Generated `app.open.<id>` commands (task 0080): one per visible app, with
 * Ctrl+Shift+<slot> (Cmd+Shift on macOS) by the user's order, plus
 * `app.goToStudy` on Ctrl+Shift+0. Rebuilt whenever the registry, the nav
 * preferences or the locale change.
 */
import type { IDisposable } from '../types/Command';
import type { AppServices } from '../contexts/ContextProvider';
import { translateWithDefault } from '../hooks/useXrefGraphLabels';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { appRegistry, openApp } from './appHost';
import { currentNavItems } from './navPrefs';
import { resolveLabelRef } from './navEntries';

export const APP_OPEN_PREFIX = 'app.open.';
export const APP_GO_TO_STUDY = 'app.goToStudy';

type Services = Pick<AppServices, 'registry' | 'i18n'>;

/** Register (and keep in sync) the app commands. Returns a disposer. */
export function installAppCommands(services: Services): IDisposable {
  const { registry, i18n } = services;
  const t = (key: string, params?: Record<string, unknown>): string => i18n.t(key, params);
  let batch: IDisposable[] = [];
  let signature = '';

  const rebuild = (): void => {
    const items = currentNavItems('menu');
    const next = JSON.stringify([i18n.currentLocale, items.map((i) => [i.id, resolveLabelRef(i.title, t, i18n), i.shortcutSlot])]);
    if (next === signature) return;
    signature = next;
    for (const d of batch) d.dispose();
    batch = [];
    const category = translateWithDefault(t, 'apps.category', 'Apps');
    for (const item of items) {
      const slot = item.shortcutSlot;
      batch.push(
        registry.register({
          id: APP_OPEN_PREFIX + item.id,
          title: resolveLabelRef(item.title, t, i18n),
          category,
          ...(slot ? { shortcut: { key: `Ctrl+Shift+${slot}`, mac: `Cmd+Shift+${slot}` } } : {}),
          handler: () => {
            void openApp(item.id, { source: 'shortcut' });
          },
        }),
      );
    }
    batch.push(
      registry.register({
        id: APP_GO_TO_STUDY,
        title: translateWithDefault(t, 'apps.study.title', 'Study'),
        category,
        shortcut: { key: 'Ctrl+Shift+0', mac: 'Cmd+Shift+0' },
        handler: () => {
          void openApp('study', { source: 'shortcut' });
        },
      }),
    );
  };

  rebuild();
  const unsubs = [
    appRegistry.state.subscribe(rebuild),
    usePreferencesStore.subscribe((s, prev) => {
      if (s.appOrder !== prev.appOrder || s.appHidden !== prev.appHidden) rebuild();
    }),
  ];
  const localeSub = i18n.onDidChangeLocale(rebuild);

  return {
    dispose() {
      for (const u of unsubs) u();
      localeSub.dispose();
      for (const d of batch) d.dispose();
      batch = [];
      signature = '';
    },
  };
}
