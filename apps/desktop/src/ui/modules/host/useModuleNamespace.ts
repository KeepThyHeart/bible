/**
 * Hold a module's view back until its string namespace has loaded, so the pane never paints
 * `[key]` placeholders. Namespaces otherwise load on the first `t()` of a key whose first segment
 * is the namespace name, which a pane's keys (`timelinePane.*`) do not match.
 */
import { useEffect, useState } from 'react';
import { useI18n } from '../../contexts/useI18n';

const loaded = new Set<string>();

/** True once `locales/<locale>/<namespace>.json` is in (or when there is no loader to wait for). */
export function useModuleNamespace(namespace: string): boolean {
  const { i18n } = useI18n();
  const load = i18n?.loadNamespace?.bind(i18n);
  const [ready, setReady] = useState(() => !load || loaded.has(namespace));
  useEffect(() => {
    if (!load || ready) return;
    let cancelled = false;
    void load(namespace).then(
      () => { loaded.add(namespace); if (!cancelled) setReady(true); },
      () => { if (!cancelled) setReady(true); },
    );
    return () => { cancelled = true; };
  }, [load, namespace, ready]);
  return ready;
}
