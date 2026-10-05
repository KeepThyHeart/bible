import { useEffect, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { useStore } from '../../hooks/useStore';
import { presentStore } from '../../stores/presentStore';

type Bar = ComponentType<{ compact?: boolean }>;
let loaded: Bar | null = null;
let loading: Promise<Bar> | null = null;

function loadBar(): Promise<Bar> {
  loading ??= import('./PresentBar').then(m => (loaded = m.PresentBar));
  return loading;
}

/** Study's companion strip: its chunk is fetched only once a session is live. */
export function LazyPresentBar(props: { compact?: boolean }) {
  const live = useStore(presentStore, () => presentStore.session !== null);
  const [Bar, setBar] = useState<Bar | null>(loaded);
  useEffect(() => {
    if (!live || Bar) return;
    let cancelled = false;
    loadBar().then(b => { if (!cancelled) setBar(() => b); }, () => { loading = null; });
    return () => { cancelled = true; };
  }, [live, Bar]);
  if (!live || !Bar) return null;
  return <Bar compact={props.compact} />;
}
