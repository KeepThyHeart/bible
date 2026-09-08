import { useEffect, useRef, useState } from 'react';

/**
 * Debounces a raw loading flag so brief fetches never flip a loading UI on at
 * all. Ports web's `deferLoading` behavior (`apps/web/src/stores/bibleStore.ts`
 * `deferLoading`), which only marks a tab `loading` once a fetch has been in
 * flight for more than 80ms - desktop currently flips its various `isLoading`
 * flags the instant a fetch starts, which flickers a loading state in even
 * for content that resolves from cache or a fast query.
 *
 * Semantics:
 * - `rawLoading` goes `true` -> after `delay`ms of still being `true`, the
 *   returned value becomes `true`.
 * - `rawLoading` goes `false` at any point (including before `delay`
 *   elapses) -> the returned value goes `false` immediately, so a loading UI
 *   never appears on the way out either.
 */
export function useDeferredLoading(rawLoading: boolean, delay = 80): boolean {
  const [deferred, setDeferred] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (rawLoading) {
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        setDeferred(true);
      }, delay);
    } else {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setDeferred(false);
    }
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [rawLoading, delay]);

  return deferred;
}
