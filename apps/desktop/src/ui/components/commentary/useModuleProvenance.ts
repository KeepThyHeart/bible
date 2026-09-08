/**
 * Resolves whether a commentary module's text was machine generated.
 *
 * Two-stage answer so the notice is never late:
 *
 *  1. Synchronously, from the abbreviation, for the known SYNTHESIS digest.
 *     The disclosure is on screen in the same paint as the text it qualifies.
 *  2. Asynchronously, from the module's own `module_info` row, for any other
 *     module that declares itself generated. A module added later is covered
 *     without touching this code.
 *
 * Metadata is fetched once per abbreviation per renderer session and cached at
 * module scope, so the Overview grid listing thirty commentaries does not fire
 * thirty IPC calls per verse.
 */

import { useEffect, useState } from 'react';
import { commentaryAPI } from '../../services/electronAPI';
import {
  getModuleProvenanceKind,
  isDigestModule,
  type ModuleProvenanceKind,
  type ModuleProvenanceMetadata,
} from '../../moduleDescriptions';

/** abbreviation -> resolved metadata (null once a lookup has failed). */
const metadataCache = new Map<string, ModuleProvenanceMetadata | null>();
/** In-flight lookups, so concurrent callers share one IPC round-trip. */
const inFlight = new Map<string, Promise<ModuleProvenanceMetadata | null>>();
/** Components waiting on any lookup, notified when the cache grows. */
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function fetchMetadata(abbreviation: string): Promise<ModuleProvenanceMetadata | null> {
  const existing = inFlight.get(abbreviation);
  if (existing) return existing;

  const request = commentaryAPI
    .getCommentaryInfo(abbreviation)
    .then((info: unknown) => (info ?? null) as ModuleProvenanceMetadata | null)
    .catch(() => null)
    .then((info) => {
      metadataCache.set(abbreviation, info);
      inFlight.delete(abbreviation);
      notify();
      return info;
    });

  inFlight.set(abbreviation, request);
  return request;
}

/** Test seam: drop everything this module has cached. */
export function resetModuleProvenanceCache(): void {
  metadataCache.clear();
  inFlight.clear();
  notify();
}

/**
 * Returns the provenance kind for a module, or `null` when its text reads as
 * ordinary human-authored commentary.
 */
export function useModuleProvenance(
  moduleAbbr: string | null | undefined
): ModuleProvenanceKind | null {
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!moduleAbbr) return;
    // The digest already answers "yes" from its abbreviation; nothing its
    // metadata could say would change the notice, so skip the round-trip.
    if (isDigestModule(moduleAbbr)) return;

    const listener = () => forceRender((n) => n + 1);
    listeners.add(listener);

    if (!metadataCache.has(moduleAbbr)) {
      void fetchMetadata(moduleAbbr);
    }

    return () => {
      listeners.delete(listener);
    };
  }, [moduleAbbr]);

  return getModuleProvenanceKind(
    moduleAbbr,
    moduleAbbr ? metadataCache.get(moduleAbbr) : undefined
  );
}
