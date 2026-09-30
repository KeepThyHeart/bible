/**
 * Fetching the hymn behind whatever the presenter has put on the wall.
 *
 * The same two rules as `usePassage`, for the same reasons: hymns are cached
 * for the life of the page, because a service returns to the same hymn between
 * readings and a re-fetch that empties the screen reads as a glitch; and a
 * failed fetch leaves the previous slide up, because nothing that goes wrong
 * may blank the wall.
 *
 * The slides arrive already packed. That is not a division of labour chosen for
 * the viewer's convenience -- the server owns what `next` means, so it has to
 * know how many slides there are, and two viewers packing independently could
 * disagree about where a hymn ends.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { API_BASE } from '../utils/apiUrl';
import type { HymnDetail } from './hymns';
import type { PresentItem } from './protocol';

function hymnKey(item: PresentItem | null): string | null {
  if (!item || item.kind !== 'hymn') return null;
  // The order is part of the identity: the same hymn sung with a refrain
  // between every verse is a different set of slides.
  return `${item.hymnId}?${(item.verseOrder ?? []).join(' ')}`;
}

export function useHymn(item: PresentItem | null): HymnDetail | null {
  const key = hymnKey(item);
  const cache = useRef(new Map<string, HymnDetail>());
  // Keyed, so a hymn that has arrived is never shown under a different one's
  // name while its replacement is still in flight.
  const [loaded, setLoaded] = useState<{ key: string; hymn: HymnDetail } | null>(null);

  useEffect(() => {
    if (!key || !item || item.kind !== 'hymn') return;

    const cached = cache.current.get(key);
    if (cached) {
      setLoaded({ key, hymn: cached });
      return;
    }

    let cancelled = false;
    const order = item.verseOrder?.length ? `?order=${encodeURIComponent(item.verseOrder.join(' '))}` : '';
    fetch(`${API_BASE}/api/hymns/${encodeURIComponent(item.hymnId)}${order}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((detail: HymnDetail) => {
        if (cancelled) return;
        cache.current.set(key, detail);
        setLoaded({ key, hymn: detail });
      })
      .catch(() => {
        // A hymn that is not in this install's library, or a request that
        // failed. Either way the wall keeps whatever it had.
      });

    return () => { cancelled = true; };
  }, [key]);

  return loaded && loaded.key === key ? loaded.hymn : null;
}
