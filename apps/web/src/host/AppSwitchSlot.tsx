/**
 * The switcher an app puts in its own chrome (Study's Header, the Presenter's
 * app bar, the "Study" bar of apps without chrome). One button that opens the
 * `AppSheet`. It renders nothing while there is nothing to switch to or while
 * the wide-screen rail already offers the switch, so apps can place it
 * unconditionally.
 */
import { useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { AppSheet, AppSwitchButton } from '@bible/ui';
import type { AppNavBadge } from '@bible/ui';
import { appHost, openApp, prefetchApp } from './appHost';
import { useNavEntries } from './appNavEntries';
import { useNavItems, useRailVisible } from './navPrefs';
import { useReadable } from './useReadable';

/** The most urgent badge among the apps other than the one on screen. */
export function aggregateBadge(
  entries: readonly { id: string; badge?: AppNavBadge }[],
  activeId: string | null,
): AppNavBadge | undefined {
  const rank = { attention: 2, live: 1, neutral: 0 } as const;
  let best: AppNavBadge | undefined;
  for (const e of entries) {
    if (e.id === activeId || !e.badge) continue;
    if (!best || rank[e.badge.tone] > rank[best.tone]) best = e.badge;
  }
  return best;
}

export function AppSwitchSlot({ className }: { className?: string }) {
  const { t } = useTranslation();
  const items = useNavItems('sheet');
  const entries = useNavEntries(items);
  const railVisible = useRailVisible();
  const { activeId } = useReadable(appHost);
  const [open, setOpen] = useState(false);

  if (items.length < 2 || railVisible) return null;
  const title = t('apps.switch.label', 'Switch app');
  return (
    <>
      <AppSwitchButton
        className={className}
        title={title}
        icon={<i class="fa-solid fa-table-cells-large" aria-hidden="true" />}
        badge={aggregateBadge(entries, activeId)}
        onClick={() => { setOpen(true); for (const e of entries) prefetchApp(e.id); }}
      />
      <AppSheet
        open={open}
        onClose={() => setOpen(false)}
        items={entries}
        activeId={activeId}
        onSelect={(id) => { void openApp(id); }}
        title={t('apps.sheet.title', 'Apps')}
        labels={{ close: t('apps.sheet.close', 'Close') }}
      />
    </>
  );
}
