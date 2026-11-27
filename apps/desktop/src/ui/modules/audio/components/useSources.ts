import { useEffect, useState } from 'react';
import type { SourceStatus } from '@bible/audio';
import { audioStore, useAudio } from '../audioState';

/**
 * Every registered source for a translation, with whether it can play here.
 * Empty until the first answer; asks again when a download or removal changes
 * what can play (`audioStore.invalidateSources`).
 */
export function useSources(moduleAbbr: string | null | undefined): SourceStatus[] {
  const [list, setList] = useState<SourceStatus[]>([]);
  const version = useAudio(s => s.sourcesVersion);
  const enabled = useAudio(s => s.enabled);
  useEffect(() => {
    if (!moduleAbbr || !enabled) { setList([]); return; }
    let live = true;
    void audioStore.sources(moduleAbbr).then(l => { if (live) setList(l); }, () => { if (live) setList([]); });
    return () => { live = false; };
  }, [moduleAbbr, version, enabled]);
  return list;
}
