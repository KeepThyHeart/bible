/**
 * Generated `app.open.<id>` commands (task 0080): one per visible app, with
 * Ctrl+Shift+<slot> (Cmd+Shift on macOS) by the user's order, plus
 * Ctrl+Shift+0 for Study (a second key on Study's own command; `app.goToStudy` only when Study is not a listed app). Rebuilt whenever the registry, the nav
 * preferences or the locale change.
 */
import type { IDisposable } from '../types/Command';
import type { AppServices } from '../contexts/ContextProvider';
import { translateWithDefault } from '../utils/translateWithDefault';
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
    // B-032: Study is reachable on Ctrl+Shift+0 whatever its slot. When Study
    // has its own app.open command, that command carries both keys; a second
    // "Apps: Study" palette entry would just be a duplicate.
    const goToStudy = { key: 'Ctrl+Shift+0', mac: 'Cmd+Shift+0' };
    const hasStudyItem = items.some((i) => i.id === 'study');
    for (const item of items) {
      const slot = item.shortcutSlot;
      const slotKey = slot ? { key: `Ctrl+Shift+${slot}`, mac: `Cmd+Shift+${slot}` } : undefined;
      const shortcut =
        item.id === 'study'
          ? slotKey
            ? [slotKey, goToStudy]
            : goToStudy
          : slotKey;
      batch.push(
        registry.register({
          id: APP_OPEN_PREFIX + item.id,
          title: resolveLabelRef(item.title, t, i18n),
          category,
          ...(shortcut ? { shortcut } : {}),
          handler: () => {
            void openApp(item.id, { source: 'shortcut' });
          },
        }),
      );
    }
    if (hasStudyItem) return;
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
