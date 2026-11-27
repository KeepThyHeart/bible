import { useEffect, useState } from 'preact/hooks';
import type { SourceStatus } from '@bible/audio';
import { audioStore } from '../audioStore';
import { useStore } from '../../../hooks/useStore';

/** The last answer per translation and `sourcesVersion`, so a panel opened again draws at once. */
const cache = new Map<string, SourceStatus[]>();
const keyOf = (moduleAbbr: string, version: number) => `${moduleAbbr}@${version}`;

/**
 * Every registered source for a translation, with whether it can play here, and whether the
 * answer is in (`loaded`). Asks again when a download or removal changes what can play
 * (`audioStore.invalidateSources`); an answer already given for the same state is used at once.
 */
export function useSourcesState(moduleAbbr: string | null | undefined): { list: SourceStatus[]; loaded: boolean } {
  const version = useStore(audioStore, () => audioStore.sourcesVersion);
  const enabled = useStore(audioStore, () => audioStore.enabled);
  const key = moduleAbbr && enabled ? keyOf(moduleAbbr, version) : null;
  const [state, setState] = useState<{ key: string | null; list: SourceStatus[] }>(() => ({ key, list: (key && cache.get(key)) || [] }));
  useEffect(() => {
    if (!key || !moduleAbbr) { setState({ key, list: [] }); return; }
    const hit = cache.get(key);
    if (hit) { setState({ key, list: hit }); return; }
    let live = true;
    void audioStore.sources(moduleAbbr).then(
      l => { cache.set(key, l); if (live) setState({ key, list: l }); },
      () => { if (live) setState({ key, list: [] }); },
    );
    return () => { live = false; };
  }, [key]);
  const cached = key ? cache.get(key) : undefined;
  if (state.key === key) return { list: state.list, loaded: !key || !!cached || state.list.length > 0 };
  return { list: cached ?? [], loaded: !!cached };
}

/** Every registered source for a translation (empty until the first answer). */
export function useSources(moduleAbbr: string | null | undefined): SourceStatus[] {
  return useSourcesState(moduleAbbr).list;
}

/** Tests: forget remembered answers. */
export function clearSourcesCache(): void { cache.clear(); }
