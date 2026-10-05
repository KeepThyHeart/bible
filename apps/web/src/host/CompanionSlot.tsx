/**
 * Study's companion strips: for every registered app whose binding has a
 * `companion` (`busy`: only while the app reports busy; `always`), render its
 * view in registry order. Each companion's code loads through a module-level
 * promise cache, only once it applies (the PresentBar chunk stays out of the
 * way until a session is live). Renders a fragment, with no wrapper, so the
 * strips' own CSS is unchanged.
 */
import { useEffect, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { appRegistry, getAppCompanion } from './appHost';
import { useReadable } from './useReadable';

type CompanionView = ComponentType<{ compact?: boolean }>;

const cache = new Map<string, Promise<CompanionView>>();
const resolved = new Map<string, CompanionView>();

function loadCompanion(id: string): Promise<CompanionView> | null {
  let p = cache.get(id);
  if (!p) {
    const binding = getAppCompanion(id);
    if (!binding) return null;
    p = binding.load().then(
      (m) => {
        resolved.set(id, m.View);
        return m.View;
      },
      (err: unknown) => {
        cache.delete(id); // the next render retries
        throw err;
      },
    );
    cache.set(id, p);
  }
  return p;
}

function Companion({ id, compact }: { id: string; compact?: boolean }) {
  const [View, setView] = useState<CompanionView | null>(() => resolved.get(id) ?? null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (View) return;
    let live = true;
    loadCompanion(id)?.then(
      (v) => { if (live) setView(() => v); },
      () => { if (live) setTimeout(() => live && setAttempt((n) => n + 1), 3000); },
    );
    return () => { live = false; };
  }, [id, View, attempt]);
  return View ? <View compact={compact} /> : null;
}

export function CompanionSlot({ compact }: { compact?: boolean }) {
  const { apps } = useReadable(appRegistry.state);
  return (
    <>
      {apps.map((entry) => {
        const c = getAppCompanion(entry.item.id);
        if (!c || !(c.when === 'always' || entry.busy)) return null;
        return <Companion key={entry.item.id} id={entry.item.id} compact={compact} />;
      })}
    </>
  );
}

/** Test hook. */
export function resetCompanionSlotForTest(): void {
  cache.clear();
  resolved.clear();
}
