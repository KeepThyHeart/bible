import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { AppSheet, AppSwitchButton, aggregateBadge } from '@bible/ui';
import { shouldShowRail } from '@bible/core/browser';
import { useI18n } from '../contexts/useI18n';
import { translateWithDefault } from '../utils/translateWithDefault';
import { appHostStore, openApp, prefetchApp } from './appHost';
import { useNavItems, useRailMode } from './navPrefs';
import { toNavEntries } from './navEntries';

/** Below this width (CSS px, so UI zoom counts) the rail folds into the header's app-switch button. */
export const NARROW_APPS_QUERY = '(max-width: 599px)';

/** True while the window is narrower than 600 CSS px. */
export function useNarrowApps(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_APPS_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(NARROW_APPS_QUERY);
    const on = (): void => setNarrow(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return narrow;
}

/**
 * The header's app-switch button for a narrow window (task 0222 R3-12). Renders nothing while the
 * window is wide (the rail does the job) or when the switcher would not show a rail at all.
 */
export const DesktopAppSwitch: React.FC = () => {
  const { t, i18n } = useI18n();
  const narrow = useNarrowApps();
  const items = useNavItems('rail');
  const mode = useRailMode();
  const { activeId } = useSyncExternalStore(appHostStore.subscribe, appHostStore.getSnapshot);
  const [open, setOpen] = useState(false);

  if (!narrow || !shouldShowRail(mode, items.length)) return null;
  const entries = toNavEntries(items, t, i18n);
  const active = entries.find((e) => e.id === activeId);
  const title = translateWithDefault(t, 'apps.switcher.open', 'Switch app');
  return (
    <>
      <AppSwitchButton
        className="flex-shrink-0"
        caret
        title={title}
        icon={active?.icon ?? null}
        badge={aggregateBadge(entries, activeId)}
        onClick={() => { setOpen(true); for (const e of entries) prefetchApp(e.id); }}
      />
      <AppSheet
        open={open}
        onClose={() => setOpen(false)}
        items={entries}
        activeId={activeId}
        onSelect={(id) => { void openApp(id); }}
        title={translateWithDefault(t, 'apps.rail.label', 'Apps')}
        labels={{ close: translateWithDefault(t, 'apps.sheet.close', 'Close') }}
      />
    </>
  );
};

export default DesktopAppSwitch;
