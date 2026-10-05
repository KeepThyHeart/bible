import React, { useSyncExternalStore } from 'react';
import { appRegistry, getAppCompanion, useIsAppActive } from './appHost';
import type { AppView } from './appHost';

const loads = new Map<string, Promise<{ readonly View: AppView }>>();

function loadCompanion(id: string, load: () => Promise<{ readonly View: AppView }>) {
  let p = loads.get(id);
  if (!p) {
    p = load().catch((err: unknown) => {
      loads.delete(id); // retry on the next render
      throw err;
    });
    loads.set(id, p);
  }
  return p;
}

const Companion: React.FC<{ id: string; load: () => Promise<{ readonly View: AppView }> }> = ({ id, load }) => {
  const [View, setView] = React.useState<AppView | null>(null);
  React.useEffect(() => {
    let live = true;
    loadCompanion(id, load).then(
      (m) => { if (live) setView(() => m.View); },
      (err) => console.warn(`[CompanionSlot] "${id}" failed to load:`, err),
    );
    return () => { live = false; };
  }, [id, load]);
  return View ? <View /> : null;
};

/**
 * Companion strips (a slim bar an app shows inside Study), above the StatusBar.
 * Renders nothing in M2 (no app has a companion on desktop); a binding with
 * `companion: {when: 'busy' | 'always'}` appears here while its condition holds,
 * and only while Study is the app on screen.
 */
export const CompanionSlot: React.FC = () => {
  const studyActive = useIsAppActive('study');
  const state = useSyncExternalStore(appRegistry.state.subscribe, appRegistry.state.getSnapshot);
  if (!studyActive) return null;
  const shown = state.apps.flatMap((entry) => {
    const c = getAppCompanion(entry.item.id);
    return c && (c.when === 'always' || entry.busy) ? [{ id: entry.item.id, load: c.load }] : [];
  });
  if (shown.length === 0) return null;
  return <>{shown.map((c) => <Companion key={c.id} id={c.id} load={c.load} />)}</>;
};

export default CompanionSlot;

/** Test helper. */
export function resetCompanionLoadsForTest(): void {
  loads.clear();
}
