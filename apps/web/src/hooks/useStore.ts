import { useState, useEffect, useRef } from 'preact/hooks';
/** Anything with `subscribe` (the app's `Store`, and the shared `@bible/audio` stores). */
export interface Subscribable {
  subscribe(listener: () => void): () => void;
}

export function useStore<T>(store: Subscribable, selector: () => T): T {
  const [, forceUpdate] = useState(0);
  const valueRef = useRef<T>(selector());

  useEffect(() => {
    const update = () => {
      valueRef.current = selector();
      forceUpdate(n => n + 1);
    };
    const unsubscribe = store.subscribe(update);
    // The store may have changed between this render and this effect (effects run after paint, and
    // the subscription did not exist yet): catch up now, or the component shows stale state until
    // the next change -- which, for a store set once (a follow link's `active`), is never.
    // (A selector that builds a new object each call fails this check once per mount: one extra render.)
    if (!Object.is(valueRef.current, selector())) update();
    return unsubscribe;
  }, [store]);

  valueRef.current = selector();
  return valueRef.current;
}
