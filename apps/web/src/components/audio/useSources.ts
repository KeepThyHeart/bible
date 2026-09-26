import { useEffect, useState } from 'preact/hooks';
import type { SourceStatus } from '../../audio/AudioSourceResolver';
import { audioStore } from '../../stores/audioStore';
import { useStore } from '../../hooks/useStore';

/**
 * Every registered source for a translation, with whether it can play here.
 * Empty until the first answer; asks again when a download or removal changes
 * what can play (`audioStore.invalidateSources`).
 */
export function useSources(moduleAbbr: string | null | undefined): SourceStatus[] {
  const [list, setList] = useState<SourceStatus[]>([]);
  const version = useStore(audioStore, () => audioStore.sourcesVersion);
  const enabled = useStore(audioStore, () => audioStore.enabled);
  useEffect(() => {
    if (!moduleAbbr || !enabled) { setList([]); return; }
    let live = true;
    void audioStore.sources(moduleAbbr).then(l => { if (live) setList(l); }, () => { if (live) setList([]); });
    return () => { live = false; };
  }, [moduleAbbr, version, enabled]);
  return list;
}
